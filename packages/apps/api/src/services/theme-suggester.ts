import { getBrandProfileContext } from './brand-profile.js';
import { classifyTopicsToCanonical, canonicalizeTopic } from '@postolio/taxonomy';
import { getDatabaseClient } from '../config/database.js';

export type CampaignType =
  | 'promotional'
  | 'educational'
  | 'seasonal'
  | 'thought_leadership'
  | 'custom';

export interface ThemeSuggestion {
  value: string;
  score: number; // 0..1
  source: 'profile' | 'heuristic' | 'fallback';
  perfDelta?: number; // relative delta vs mean (negative..positive)
  reasons?: string[];
}

const FALLBACK_BY_TYPE: Record<CampaignType, string[]> = {
  promotional: [
    'product showcase',
    'customer stories',
    'limited-time offer',
    'bundle & save',
    'new arrivals',
    'behind the scenes',
  ],
  educational: [
    'tips & tutorials',
    'how-to guides',
    'best practices',
    'common mistakes',
    'industry insights',
    'faq',
  ],
  seasonal: ['seasonal content', 'holiday stories', 'event highlights', 'gift guides'],
  thought_leadership: [
    'industry insights',
    'trends & predictions',
    'opinion pieces',
    'case studies',
    'customer stories',
  ],
  custom: ['product showcase', 'tips & tutorials', 'company culture', 'user generated content'],
};

const BOOST_TERMS: Record<Exclude<CampaignType, 'custom'>, string[]> = {
  promotional: [
    'offer',
    'sale',
    'deal',
    'discount',
    'limited',
    'launch',
    'product',
    'new',
    'drop',
    'bundle',
    'testimonial',
    'customer',
  ],
  educational: ['tips', 'tutorial', 'how to', 'guide', 'best practice', 'mistake', 'faq'],
  seasonal: ['season', 'holiday', 'black friday', 'christmas', 'summer', 'winter', 'event'],
  thought_leadership: [
    'insight',
    'trend',
    'opinion',
    'analysis',
    'prediction',
    'industry',
    'state of',
  ],
};

function normalize(str: string): string {
  return str.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 64);
}

function boostScoreByCampaignType(value: string, type?: CampaignType): number {
  if (!type || type === 'custom') return 0;
  const terms = BOOST_TERMS[type] || [];
  const v = ` ${value.toLowerCase()} `;
  let boost = 0;
  for (const t of terms) {
    if (v.includes(` ${t} `) || v.includes(` ${t}s `)) boost += 0.05;
  }
  return Math.min(0.25, boost); // cap boost
}

function boostScoreByGoals(value: string, goals?: string): number {
  if (!goals) return 0;
  const g = goals.toLowerCase();
  const v = value.toLowerCase();
  let boost = 0;
  // very light keyword matching
  if (/awareness|reach|visibility/.test(g) && /awareness|trend|viral/.test(v)) boost += 0.05;
  if (/conversion|sales|revenue|checkout|signup/.test(g) && /testimonial|product|offer/.test(v))
    boost += 0.075;
  if (/education|learn|teach|inform/.test(g) && /tips|how|guide|faq/.test(v)) boost += 0.075;
  return Math.min(0.2, boost);
}

export async function suggestThemes(params: {
  brandId: string;
  campaignType?: CampaignType | null;
  goals?: string | null;
  limit?: number;
}): Promise<{ suggestions: ThemeSuggestion[] }> {
  const { brandId, campaignType, goals, limit = 8 } = params;

  const ctx = await getBrandProfileContext(brandId);
  const prisma = getDatabaseClient();

  // Compute recent theme performance deltas from brand content (Stage 3)
  const performanceByTheme = new Map<string, number>();
  try {
    const recent = await prisma.contentPublication.findMany({
      where: { content: { brandId } },
      select: {
        metricsLatest: true,
        content: { select: { caption: true, hashtags: true } },
      },
      orderBy: { publishedAt: 'desc' },
      take: 100,
    });
    const metrics: Array<{ value: number; themes: string[] }> = [];
    for (const p of recent) {
      const m = p.metricsLatest;
      const interactions = (m?.likes || 0) + (m?.comments || 0) + (m?.saves || 0);
      const base = m?.reach || 0 || m?.impressions || 0;
      const engagement = base > 0 ? interactions / base : interactions;
      if (engagement <= 0) continue;
      const set = new Set<string>();
      for (const h of p.content?.hashtags || []) {
        const clean = String(h || '').replace(/^#/, '');
        for (const canon of canonicalizeTopic(clean)) set.add(canon);
      }
      if (p.content?.caption) {
        for (const canon of canonicalizeTopic(p.content.caption)) set.add(canon);
      }
      if (set.size > 0) metrics.push({ value: engagement, themes: Array.from(set) });
    }
    const overallMean = metrics.length
      ? metrics.reduce((s, m) => s + m.value, 0) / metrics.length
      : 0;
    if (overallMean > 0) {
      const sums = new Map<string, { total: number; n: number }>();
      for (const m of metrics) {
        for (const t of m.themes) {
          const k = normalize(t);
          const prev = sums.get(k) || { total: 0, n: 0 };
          prev.total += m.value;
          prev.n += 1;
          sums.set(k, prev);
        }
      }
      for (const [k, { total, n }] of sums.entries()) {
        const mean = total / Math.max(1, n);
        const delta = (mean - overallMean) / overallMean; // -1..+inf
        // clamp to reasonable range
        performanceByTheme.set(k, Math.max(-0.5, Math.min(0.5, delta)));
      }
    }
  } catch {
    // non-fatal
  }
  const out: ThemeSuggestion[] = [];

  // 1) Primary: derive from brand profile topics -> canonical themes
  const topics = Array.isArray(ctx?.topicsTop) ? ctx!.topicsTop! : [];
  // Track contributions: which raw topics map to each canonical theme
  const topicContribution = new Map<string, Map<string, number>>();
  if (topics.length > 0) {
    for (const t of topics.slice(0, 50)) {
      if (!t?.value) continue;
      const cands = canonicalizeTopic(t.value);
      for (const c of cands) {
        const key = normalize(c);
        const inner = topicContribution.get(key) || new Map<string, number>();
        const tn = normalize(t.value);
        inner.set(tn, (inner.get(tn) || 0) + Math.max(1, Number(t.count) || 1));
        topicContribution.set(key, inner);
      }
    }
  }
  if (topics.length > 0) {
    const canon = classifyTopicsToCanonical(topics, { maxResults: 30 });
    for (const c of canon) {
      const v = normalize(c.value);
      const base = Math.max(0.1, c.score);
      const perf = performanceByTheme.get(v) || 0;
      const perfBoost = perf > 0 ? Math.min(0.2, perf * 0.4) : 0; // cap boost
      const ctBoost = boostScoreByCampaignType(v, (campaignType || undefined) as CampaignType);
      const goalBoost = boostScoreByGoals(v, goals || undefined);
      const score = Math.min(1, base + ctBoost + goalBoost + perfBoost);
      const reasons: string[] = [];
      const contrib = topicContribution.get(v);
      if (contrib && contrib.size) {
        const top = Array.from(contrib.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([name]) => name);
        if (top.length) reasons.push(`Topics: ${top.join(', ')}`);
      }
      if (ctBoost > 0) reasons.push(`Campaign boost +${Math.round(ctBoost * 100)}%`);
      if (goalBoost > 0) reasons.push(`Goals boost +${Math.round(goalBoost * 100)}%`);
      if (perfBoost > 0) reasons.push(`Performance +${Math.round(perf * 100)}% vs avg`);
      reasons.push('Source: brand topics');
      out.push({ value: v, score, source: 'profile', perfDelta: perf, reasons });
    }
  }

  // 2) Heuristics: tones implying themes
  const tones = Array.isArray(ctx?.tones) ? ctx!.tones : [];
  for (const tone of tones.slice(0, 10)) {
    const v = normalize(tone);
    if (!v) continue;
    const implied: string[] = [];
    if (/playful|fun|casual/.test(v)) implied.push('behind the scenes', 'memes & trends');
    if (/professional|authoritative|expert|thoughtful/.test(v)) implied.push('industry insights');
    if (/inspir/.test(v)) implied.push('customer stories');
    for (const theme of implied) {
      const k = normalize(theme);
      const perf = performanceByTheme.get(k) || 0;
      const perfBoost = perf > 0 ? Math.min(0.2, perf * 0.4) : 0;
      const ctBoost = boostScoreByCampaignType(k, (campaignType || undefined) as CampaignType);
      const s = 0.35 + ctBoost + perfBoost;
      const reasons: string[] = [`Tone: ${tone}`];
      if (ctBoost > 0) reasons.push(`Campaign boost +${Math.round(ctBoost * 100)}%`);
      if (perfBoost > 0) reasons.push(`Performance +${Math.round(perf * 100)}% vs avg`);
      reasons.push('Source: tone heuristic');
      out.push({
        value: k,
        score: Math.min(0.8, s),
        source: 'heuristic',
        perfDelta: perf,
        reasons,
      });
    }
  }

  // dedupe by best score
  const best = new Map<string, ThemeSuggestion>();
  for (const s of out) {
    const key = normalize(s.value);
    const existing = best.get(key);
    if (!existing || s.score > existing.score) best.set(key, { ...s, value: key });
  }
  let suggestions = Array.from(best.values()).sort((a, b) => b.score - a.score);

  // 3) Fallbacks if insufficient data
  if (suggestions.length < Math.min(4, limit)) {
    const type = (campaignType || 'custom') as CampaignType;
    const fb = (FALLBACK_BY_TYPE[type] || FALLBACK_BY_TYPE.custom).map((v, i) => {
      const k = normalize(v);
      const perf = performanceByTheme.get(k) || 0;
      const perfBoost = perf > 0 ? Math.min(0.15, perf * 0.3) : 0;
      const ctBoost = boostScoreByCampaignType(k, (campaignType || undefined) as CampaignType);
      return {
        value: k,
        score: 0.28 - i * 0.02 + perfBoost + ctBoost,
        source: 'fallback' as const,
        perfDelta: perf,
        reasons: [
          'Source: campaign defaults',
          ctBoost > 0 ? `Campaign boost +${Math.round(ctBoost * 100)}%` : undefined,
          perfBoost > 0 ? `Performance +${Math.round(perf * 100)}% vs avg` : undefined,
        ].filter(Boolean) as string[],
      };
    });
    const seen = new Set(suggestions.map((s) => s.value));
    for (const f of fb) if (!seen.has(f.value)) suggestions.push(f);
  }

  // limit and return
  suggestions = suggestions
    .filter((s) => s.value && s.value.length >= 2)
    .slice(0, Math.max(1, Math.min(16, limit)));

  return { suggestions };
}
