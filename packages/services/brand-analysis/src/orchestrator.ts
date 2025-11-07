import { randomUUID } from 'crypto';
import { ProfileRepository } from './dynamo/profile-repo';
import { JobRepository, type BrandAnalysisJob } from './dynamo/job-repo';
import { runTextExtractor } from './pipeline/text-extractor';
import { runTopicEntityExtractor } from './pipeline/topic-entity-extractor';
import { runEngagementCorrelationFromPosts } from './pipeline/engagement-correlation';
import { runVisualExtractor } from './pipeline/visual-extractor';
import { inferVisualStyles } from './pipeline/style-inference';
import { synthesizeProfile } from './pipeline/synthesis';
import { LearningRepository } from './dynamo/learning-repo';
import { validateProfile, type BrandStyleProfile } from './models/profile-schema';
import { getAndResetLlmUsage } from './llm/llm-client';
import { PROMPT_SET_VERSION } from './prompts/prompt-set';
import { runToneExtractor } from './pipeline/tone-extractor';
import { computeHashtagMetrics } from './preprocessing/hashtag-metrics';
import { classifyPosts } from './pipeline/seasonal-detector';
import { jaccard } from './drift/drift-detector';
import { pageHinkley } from './drift/change-point';
import { estimateCausalImpact } from './pipeline/causal-impact';

export interface RunOptions {
  maxPosts?: number;
  force?: boolean;
}

type MinimalPost = {
  id?: string;
  caption?: string;
  hashtags?: string[];
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
  media_type?: string;
  media_url?: string;
};

async function fetchPostsFromInternalApi(
  brandId: string,
  limit: number
): Promise<MinimalPost[] | null> {
  const base = process.env.INTERNAL_API_URL;
  const key = process.env.INTERNAL_API_KEY;
  if (!base || !key) return null;
  const url = `${base.replace(/\/$/, '')}/api/instagram/posts/${encodeURIComponent(
    brandId
  )}?limit=${limit}`;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 10_000);
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'x-internal-key': key },
      signal: ac.signal,
    } as RequestInit);
    clearTimeout(t);
    if (!resp.ok) return null;
    const json = (await resp.json()) as { posts?: MinimalPost[] };
    return Array.isArray(json?.posts) ? json.posts : null;
  } catch {
    return null;
  }
}

export class BrandAnalysisOrchestrator {
  constructor(
    private profiles = new ProfileRepository(),
    private jobs = new JobRepository()
  ) {}

  async runBrandAnalysis(
    brandId: string,
    options: RunOptions = {},
    posts?: MinimalPost[]
  ): Promise<{ jobId: string; profile?: unknown }> {
    // Concurrency guard: if a job is currently running and force is not set, reuse it
    const latest = await this.jobs.latestForBrand(brandId);
    if (latest && latest.status === 'running' && !options.force) {
      return { jobId: latest.jobId };
    }
    const jobId = randomUUID();
    const now = new Date().toISOString();
    const job: BrandAnalysisJob = {
      jobId,
      brandId,
      status: 'requested',
      requestedAt: now,
      config: { ...options },
    };
    await this.jobs.create(job);

    await this.jobs.updateStatus(jobId, brandId, 'running', { startedAt: now });

    try {
      // If posts are not provided (e.g., scheduled run), try to fetch via internal API proxy
      if (!posts || posts.length === 0) {
        const desired = typeof options?.maxPosts === 'number' ? options.maxPosts : 20;
        const fetched = await fetchPostsFromInternalApi(brandId, desired);
        if (fetched && fetched.length) posts = fetched;
      }

      // Classify posts into core/seasonal/trending and filter out generated/campaign posts
      const countryCode =
        (options as any)?.brandInfo?.countryCode || (undefined as string | undefined);
      let freezeCore = true; // Smart Freeze default ON
      if ((options as any)?.brandInfo && (options as any).brandInfo.freezeCore !== undefined) {
        freezeCore = Boolean((options as any).brandInfo.freezeCore);
      } else if (process.env.BRAND_ANALYSIS_DEFAULT_FREEZE_CORE) {
        freezeCore = /^true$/i.test(process.env.BRAND_ANALYSIS_DEFAULT_FREEZE_CORE);
      }
      const cls = classifyPosts(posts || [], { countryCode: countryCode || undefined });

      // Use core posts to compute deterministic metrics
      const coreCaptions: string[] = Array.isArray(cls.corePosts)
        ? cls.corePosts.map((p) => String(p.caption || '')).filter((s) => s.length > 0)
        : [];
      const textOut = runTextExtractor({ captions: coreCaptions });
      const topicOut = runTopicEntityExtractor({ captions: coreCaptions });
      const hashtagCounts = computeHashtagMetrics(coreCaptions).counts;
      const toneOut = await runToneExtractor({
        captions: coreCaptions,
        hashtags: Object.entries(hashtagCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 25)
          .map(([k]) => k.replace(/^#/, '')),
      });
      const corrOut = runEngagementCorrelationFromPosts(cls.corePosts || []);
      const mediaUrls = (cls.corePosts || [])
        .filter((p) => (p.media_type || '').toUpperCase() !== 'VIDEO')
        .map((p) => p.media_url)
        .filter((u: unknown): u is string => typeof u === 'string' && u.length > 0)
        .slice(0, 10);
      const visualOut = await runVisualExtractor({ mediaUrls });

      // Infer brand-specific visual styles for AI image generation
      const styleOut = await inferVisualStyles({
        palette: visualOut.palette,
        motifs: visualOut.motifs,
        composition: visualOut.composition,
      });

      // Determine next version
      const latestProfile = await this.profiles.getLatest(brandId);
      const nextVersion = (latestProfile?.version || 0) + 1;

      // Bias tones and topics using recent learning signals (confidence + recency aware)
      const learningRepo = new LearningRepository();
      const recentSignals = await learningRepo.listRecentSignals(brandId, 20);

      // Base stopwords for tone/topic tokenization (can be extended via env)
      const STOPWORDS_BASE = [
        'user',
        'prefers',
        'adds',
        'popular',
        'niche-specific',
        'niche',
        'hashtags',
        'focus',
        'on',
        'style',
        'towards',
        'brand',
        'personality',
        'tone',
        'more',
        'less',
        'and',
        'or',
      ];
      const extraStopwords = (process.env.BRAND_ANALYSIS_STOPWORDS || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const STOPWORDS = new Set<string>([...STOPWORDS_BASE, ...extraStopwords]);

      // Weighting constants (tunable via env)
      const DECAY_DAYS = Number(process.env.BRAND_ANALYSIS_DECAY_DAYS || 30); // recency decay time constant
      const TOPIC_HINT_SCALE = Number(process.env.BRAND_ANALYSIS_TOPIC_HINT_SCALE || 5); // converts hint weight to count increment

      const nowMs = Date.now();
      const toneWeights = new Map<string, number>();
      const topicWeights = new Map<string, number>();

      function addToneToken(token: string, weight: number) {
        const key = token.trim().toLowerCase();
        if (!key || key.length < 3 || STOPWORDS.has(key)) return;
        toneWeights.set(key, (toneWeights.get(key) || 0) + weight);
      }
      function addTopicToken(token: string, weight: number) {
        const key = token.trim().toLowerCase();
        if (!key || key.length < 2 || STOPWORDS.has(key)) return;
        topicWeights.set(key, (topicWeights.get(key) || 0) + weight);
      }

      for (const sig of recentSignals) {
        const createdAt = Date.parse(sig.createdAt || new Date().toISOString());
        const ageDays = Math.max(0, (nowMs - createdAt) / (1000 * 60 * 60 * 24));
        const recency = Math.exp(-ageDays / Math.max(1, DECAY_DAYS));

        // profileUpdates
        for (const upd of sig.profileUpdates || []) {
          const conf = typeof upd.confidence === 'number' ? upd.confidence : 0.6;
          const weight = recency * conf;
          if (upd.field === 'toneOfVoice' && typeof upd.newValue === 'string') {
            const parts = (upd.newValue as string)
              .split(/[^a-z0-9]+/i)
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean);
            for (const p of parts) addToneToken(p, weight);
          }
          if (upd.field === 'contentThemes' && Array.isArray(upd.newValue)) {
            for (const t of upd.newValue as unknown[]) {
              if (typeof t === 'string' && t.length > 0) addTopicToken(t, 2 * weight); // topics slightly higher
            }
          }
        }
        // insights
        for (const ins of sig.insights || []) {
          const conf = typeof ins.confidence === 'number' ? ins.confidence : 0.6;
          const weight = recency * conf;
          if (ins.category === 'caption_style' && typeof ins.pattern === 'string') {
            const tokens = ins.pattern
              .toLowerCase()
              .split(/[^a-z0-9]+/)
              .filter((x) => x.length > 2);
            for (const t of tokens.slice(0, 5)) addToneToken(t, 0.5 * weight);
          }
          if (ins.category === 'hashtag_preference' && typeof ins.recommendation === 'string') {
            const rec = ins.recommendation.toLowerCase();
            const match = rec.match(/focus on\s+(.+)/);
            if (match) {
              const parts = match[1]
                .split(/\s+and\s+|,\s*/)
                .map((s) => s.trim())
                .filter(Boolean);
              for (const p of parts) addTopicToken(p, 1.5 * weight);
            }
          }
        }
      }

      // Build biased tones: start with model tones, add top weighted tokens
      const modelTones = (toneOut.tone || []).map((t) => t.toLowerCase());
      const extraTones = Array.from(toneWeights.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([k]) => k)
        .filter((k) => !modelTones.includes(k))
        .slice(0, 5);
      const biasedTones = Array.from(new Set([...modelTones, ...extraTones])).slice(0, 10);

      // Build biased topics: start with extracted counts, add weighted hints (scale weight into counts)
      const topicMap = new Map<string, number>();
      for (const t of topicOut.topics || []) {
        if (t && typeof t.value === 'string') topicMap.set(t.value.toLowerCase(), t.count);
      }
      for (const [k, w] of topicWeights.entries()) {
        const inc = Math.max(1, Math.round(w * TOPIC_HINT_SCALE));
        topicMap.set(k, (topicMap.get(k) || 0) + inc);
      }
      const biasedTopics = Array.from(topicMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([value, count]) => ({ value, count }));

      const draft: Record<string, unknown> = {
        brandId,
        version: nextVersion,
        promptSetVersion: PROMPT_SET_VERSION,
        textExtract: textOut,
        textTone: biasedTones,
        topics: biasedTopics,
        correlations: corrOut,
      };

      let profile = synthesizeProfile(draft) as unknown as BrandStyleProfile;
      // enrich with optional sections
      if (biasedTopics && biasedTopics.length) {
        profile.topics = biasedTopics as any;
      }
      if (biasedTones && biasedTones.length) {
        profile.text = profile.text || { tone: [] };
        profile.text.tone = Array.from(new Set([...(profile.text.tone || []), ...biasedTones]))
          .filter(Boolean)
          .slice(0, 10);
      }
      if (corrOut && corrOut.length) {
        // ensure types align
        profile.correlations = corrOut as unknown as NonNullable<BrandStyleProfile['correlations']>;
      }
      if (
        visualOut &&
        (visualOut.palette.length || visualOut.motifs.length || visualOut.composition.length)
      ) {
        profile.visual = {
          palette: visualOut.palette,
          motifs: visualOut.motifs,
          composition: visualOut.composition,
          inferredStyles: styleOut.inferredStyles,
        };
      }

      // Apply visual anchors for core palette if provided via env
      const anchorPalette = (process.env.BRAND_ANALYSIS_CORE_PALETTE_ANCHORS || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => /^#?[0-9a-f]{6}$/.test(s))
        .map((s) => (s.startsWith('#') ? s : `#${s}`));
      if (anchorPalette.length > 0) {
        profile.anchors = profile.anchors || {};
        profile.anchors.visual = profile.anchors.visual || {};
        profile.anchors.visual.palette = anchorPalette;
        // Ensure core visual palette includes anchors if palette exists
        if (profile.visual?.palette) {
          const merged = Array.from(new Set([...(profile.visual.palette || []), ...anchorPalette]));
          profile.visual.palette = merged.slice(0, 12);
        }
      }

      // Build overlays (SEASONAL, TRENDING) if appropriate
      const overlays: NonNullable<BrandStyleProfile['overlays']> = [];
      // Seasonal overlay
      if (cls.seasonalLabel && (cls.seasonalPosts?.length || 0) > 0) {
        const seasonCaptions = cls.seasonalPosts
          .map((p) => String(p.caption || ''))
          .filter((s) => s.length > 0);
        const seasonTopics = runTopicEntityExtractor({ captions: seasonCaptions });
        const seasonUrls = cls.seasonalPosts
          .filter((p) => (p.media_type || '').toUpperCase() !== 'VIDEO')
          .map((p) => p.media_url)
          .filter((u: unknown): u is string => typeof u === 'string' && u.length > 0)
          .slice(0, 10);
        const seasonVisual = await runVisualExtractor({ mediaUrls: seasonUrls });
        // Change-point detection on seasonal indicator series
        const chronPosts = [...(posts || [])].sort((a, b) => {
          const ta = Date.parse(a.timestamp || '');
          const tb = Date.parse(b.timestamp || '');
          return (ta || 0) - (tb || 0);
        });
        const seasonalSeries = chronPosts.map((p) => {
          const lbl = classifyPosts([p], { countryCode }).seasonalLabel;
          return lbl ? 1 : 0;
        });
        const ph = pageHinkley(seasonalSeries, 0.05, 5);
        let effectEstimate: number | undefined;
        if (ph.hasChange && typeof ph.index === 'number') {
          try {
            const impact = await estimateCausalImpact({
              series: seasonalSeries,
              interventionIndex: Math.max(1, ph.index),
            });
            effectEstimate = impact.effectEstimate;
          } catch {
            // ignore errors; effectEstimate remains undefined
          }
        }
        overlays.push({
          type: 'SEASONAL',
          label: cls.seasonalLabel,
          createdAt: new Date().toISOString(),
          expiresAt: cls.seasonalExpiresAt,
          visual: seasonVisual.palette.length > 0 ? { palette: seasonVisual.palette } : undefined,
          topics: (seasonTopics.topics || []).slice(0, 15),
          source: {
            reason: 'auto-seasonal-detection',
            sampleSize: cls.seasonalPosts.length,
            effectEstimate,
          },
        });
      }
      // Trending overlay (topics only, 14-day TTL)
      if ((cls.trendingPosts?.length || 0) > 0) {
        const trendingCaptions = cls.trendingPosts
          .map((p) => String(p.caption || ''))
          .filter((s) => s.length > 0);
        const trendingTopics = runTopicEntityExtractor({ captions: trendingCaptions });
        const ttl = 14 * 24 * 60 * 60 * 1000;
        overlays.push({
          type: 'TRENDING',
          label: 'trending',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + ttl).toISOString(),
          topics: (trendingTopics.topics || []).slice(0, 15),
          source: { reason: 'auto-trending-window', sampleSize: cls.trendingPosts.length },
        });
      }

      if (overlays.length > 0) {
        profile.overlays = overlays;
      }

      // Core palette gating with persistence and prior comparison
      if (latestProfile?.profile && profile.visual?.palette) {
        const prev = (latestProfile.profile as any)?.visual?.palette as string[] | undefined;
        if (Array.isArray(prev) && prev.length > 0) {
          const j = jaccard(prev, profile.visual.palette);
          const palGate = Number(process.env.BRAND_ANALYSIS_CORE_PALETTE_GATE_JACCARD || 0.6);
          if (
            (freezeCore || j < palGate) &&
            (profile.overlays || []).some((o) => o.type === 'SEASONAL')
          ) {
            // Suppress core palette change; move new palette into seasonal overlay if missing
            const seasonal = (profile.overlays || []).find((o) => o.type === 'SEASONAL');
            if (seasonal && (!seasonal.visual?.palette || seasonal.visual.palette.length === 0)) {
              seasonal.visual = seasonal.visual || {};
              seasonal.visual.palette = profile.visual.palette.slice(0, 12);
            }
            profile.driftFindings = [
              ...(Array.isArray(profile.driftFindings) ? profile.driftFindings : []),
              {
                field: 'visual.palette',
                summary: freezeCore
                  ? 'Core palette change suppressed due to freezeCore=true'
                  : `Core palette change suppressed due to seasonal overlay (J=${j.toFixed(2)})`,
              },
            ];
            // Revert core palette to previous
            profile.visual.palette = prev.slice(0, 12);
          }
        }
      }
      let validation = validateProfile(profile);
      if (!validation.ok) {
        // Retry once (Phase Two simple retry)
        profile = synthesizeProfile(draft);
        validation = validateProfile(profile);
        if (!validation.ok) {
          throw new Error(`Profile validation failed: ${(validation.errors || []).join('; ')}`);
        }
      }

      await this.profiles.putProfile({
        brandId,
        profileId: `${brandId}#${profile.version}`,
        version: profile.version,
        createdAt: profile.createdAt,
        promptSetVersion: profile.promptSetVersion,
        profile,
      });
      const usage = getAndResetLlmUsage();
      await this.jobs.updateStatus(jobId, brandId, 'completed', {
        completedAt: new Date().toISOString(),
        tokenEstimate: usage.totalTokens,
        costEstimate: Number(usage.costUsd.toFixed(6)),
      });
      return { jobId, profile };
    } catch (err) {
      await this.jobs.updateStatus(jobId, brandId, 'failed', {
        completedAt: new Date().toISOString(),
        errorCode: 'ORCHESTRATION_ERROR',
        errorMessage: (err as Error).message,
      });
      throw err;
    }
  }
}
