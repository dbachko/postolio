import { randomUUID } from 'crypto';
import { ProfileRepository } from './dynamo/profile-repo';
import { JobRepository, type BrandAnalysisJob } from './dynamo/job-repo';
import { runTextExtractor } from './pipeline/text-extractor';
import { runTopicEntityExtractor } from './pipeline/topic-entity-extractor';
import { runEngagementCorrelationFromPosts } from './pipeline/engagement-correlation';
import { runVisualExtractor } from './pipeline/visual-extractor';
import { synthesizeProfile } from './pipeline/synthesis';
import { validateProfile, type BrandStyleProfile } from './models/profile-schema';
import { getAndResetLlmUsage } from './llm/llm-client';
import { PROMPT_SET_VERSION } from './prompts/prompt-set';
import { runToneExtractor } from './pipeline/tone-extractor';
import { computeHashtagMetrics } from './preprocessing/hashtag-metrics';

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

      // Use posts to compute deterministic metrics
      const captions: string[] = Array.isArray(posts)
        ? posts.map((p) => String(p.caption || '')).filter((s) => s.length > 0)
        : [];
      const textOut = runTextExtractor({ captions });
      const topicOut = runTopicEntityExtractor({ captions });
      const hashtagCounts = computeHashtagMetrics(captions).counts;
      const toneOut = await runToneExtractor({
        captions,
        hashtags: Object.entries(hashtagCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 25)
          .map(([k]) => k.replace(/^#/, '')),
      });
      const corrOut = runEngagementCorrelationFromPosts(posts || []);
      const mediaUrls = (posts || [])
        .filter((p) => (p.media_type || '').toUpperCase() !== 'VIDEO')
        .map((p) => p.media_url)
        .filter((u: unknown): u is string => typeof u === 'string' && u.length > 0)
        .slice(0, 10);
      const visualOut = await runVisualExtractor({ mediaUrls });

      // Determine next version
      const latestProfile = await this.profiles.getLatest(brandId);
      const nextVersion = (latestProfile?.version || 0) + 1;

      const draft: Record<string, unknown> = {
        brandId,
        version: nextVersion,
        promptSetVersion: PROMPT_SET_VERSION,
        textExtract: textOut,
        textTone: toneOut.tone,
        topics: topicOut.topics,
        correlations: corrOut,
      };

      let profile = synthesizeProfile(draft) as unknown as BrandStyleProfile;
      // enrich with optional sections
      if (topicOut.topics && topicOut.topics.length) {
        profile.topics = topicOut.topics;
      }
      if (toneOut.tone && toneOut.tone.length) {
        profile.text = profile.text || { tone: [] };
        profile.text.tone = Array.from(new Set([...(profile.text.tone || []), ...toneOut.tone]))
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
        };
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
