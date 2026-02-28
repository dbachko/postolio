import { getBrandProfileContext } from './brand-profile.js';
import { classifyTopicsToCanonical, canonicalizeTopic } from '@postolio/taxonomy';
import { getDatabaseClient } from '../config/database.js';
import { clampSuggestions } from './theme-suggester-utils.js';

export interface ThemeSuggestion {
  value: string;
  score: number; // 0..1
  source: 'profile' | 'heuristic' | 'fallback' | 'user';
  perfDelta?: number; // relative delta vs mean (negative..positive)
  reasons?: string[];
}

const FALLBACK_THEMES: string[] = [
  'product showcase',
  'customer stories',
  'tips & tutorials',
  'behind the scenes',
  'company culture',
  'industry insights',
  'faq',
];

function normalize(str: string): string {
  return str.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 64);
}

const MAX_SAVED_THEMES = 40;

function normalizeThemeList(themes: unknown): string[] {
  if (!Array.isArray(themes)) {
    return [];
  }
  return Array.from(
    new Set(
      themes
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
    )
  ).slice(0, MAX_SAVED_THEMES);
}

function extractStoredThemes(preferences: unknown): string[] {
  if (!preferences || typeof preferences !== 'object') {
    return [];
  }
  const pref = preferences as Record<string, unknown>;
  const custom = normalizeThemeList((pref as any).customThemes);
  const saved = normalizeThemeList((pref as any).savedThemes);
  return Array.from(new Set([...custom, ...saved])).slice(0, MAX_SAVED_THEMES);
}

export async function storeUserThemes(brandId: string, themes: string[]): Promise<void> {
  const normalized = normalizeThemeList(themes);
  if (!normalized.length) {
    return;
  }

  const prisma = getDatabaseClient();
  const brand = await prisma.brand.findUnique({
    where: { id: brandId },
    select: { preferences: true },
  });
  if (!brand) {
    return;
  }

  const existing = extractStoredThemes(brand.preferences);
  const merged = Array.from(new Set([...normalized, ...existing])).slice(0, MAX_SAVED_THEMES);
  const existingPrefs = (brand.preferences as Record<string, unknown> | null) || {};

  try {
    await prisma.brand.update({
      where: { id: brandId },
      data: {
        preferences: { ...existingPrefs, customThemes: merged },
      },
    });
  } catch (error) {
    console.error('Failed to store user themes on brand', { brandId, error });
  }
}

async function computeThemePerformance(
  prisma: ReturnType<typeof getDatabaseClient>,
  brandId: string
): Promise<Map<string, number>> {
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

    const metrics = collectThemePerformanceMetrics(recent);
    const overallMean = calculateMeanMetricValue(metrics);
    if (overallMean <= 0) {
      return performanceByTheme;
    }

    return buildThemePerformanceMap(metrics, overallMean);
  } catch {
    // Non-fatal; fallback to neutral scoring.
  }
  return performanceByTheme;
}

function calculateEngagement(
  metricsLatest: {
    likes?: number | null;
    comments?: number | null;
    saves?: number | null;
    reach?: number | null;
    impressions?: number | null;
  } | null
): number {
  const interactions =
    (metricsLatest?.likes || 0) + (metricsLatest?.comments || 0) + (metricsLatest?.saves || 0);
  const base = metricsLatest?.reach || 0 || metricsLatest?.impressions || 0;
  return base > 0 ? interactions / base : interactions;
}

function extractPublicationThemes(publication: {
  content?: { caption?: string | null; hashtags?: string[] | null } | null;
}): string[] {
  const themes = new Set<string>();

  for (const hashtag of publication.content?.hashtags || []) {
    const clean = String(hashtag || '').replace(/^#/, '');
    for (const canonicalTopic of canonicalizeTopic(clean)) {
      themes.add(canonicalTopic);
    }
  }

  if (publication.content?.caption) {
    for (const canonicalTopic of canonicalizeTopic(publication.content.caption)) {
      themes.add(canonicalTopic);
    }
  }

  return Array.from(themes);
}

function collectThemePerformanceMetrics(
  recent: Array<{
    metricsLatest?: {
      likes?: number | null;
      comments?: number | null;
      saves?: number | null;
      reach?: number | null;
      impressions?: number | null;
    } | null;
    content?: { caption?: string | null; hashtags?: string[] | null } | null;
  }>
): Array<{ value: number; themes: string[] }> {
  const metrics: Array<{ value: number; themes: string[] }> = [];

  for (const publication of recent) {
    const engagement = calculateEngagement(publication.metricsLatest || null);
    if (engagement <= 0) {
      continue;
    }

    const themes = extractPublicationThemes(publication);
    if (themes.length === 0) {
      continue;
    }

    metrics.push({ value: engagement, themes });
  }

  return metrics;
}

function calculateMeanMetricValue(metrics: Array<{ value: number; themes: string[] }>): number {
  if (!metrics.length) {
    return 0;
  }
  return metrics.reduce((sum, metric) => sum + metric.value, 0) / metrics.length;
}

function buildThemePerformanceMap(
  metrics: Array<{ value: number; themes: string[] }>,
  overallMean: number
): Map<string, number> {
  const sums = new Map<string, { total: number; n: number }>();
  for (const metric of metrics) {
    for (const theme of metric.themes) {
      const key = normalize(theme);
      const prev = sums.get(key) || { total: 0, n: 0 };
      prev.total += metric.value;
      prev.n += 1;
      sums.set(key, prev);
    }
  }

  const performanceByTheme = new Map<string, number>();
  for (const [theme, { total, n }] of sums.entries()) {
    const mean = total / Math.max(1, n);
    const delta = (mean - overallMean) / overallMean;
    performanceByTheme.set(theme, Math.max(-0.5, Math.min(0.5, delta)));
  }
  return performanceByTheme;
}

async function loadUserThemeSuggestions(
  prisma: ReturnType<typeof getDatabaseClient>,
  brandId: string
): Promise<{ suggestions: ThemeSuggestion[]; userThemeCount: number }> {
  try {
    const brand = await prisma.brand.findUnique({
      where: { id: brandId },
      select: { preferences: true },
    });
    const storedThemes = extractStoredThemes(brand?.preferences);
    return {
      userThemeCount: storedThemes.length,
      suggestions: storedThemes.map((value, index) => ({
        value: normalize(value),
        score: 1 - index * 0.01,
        source: 'user' as const,
        reasons: ['Saved from your previous posts'],
      })),
    };
  } catch (err) {
    console.error('Failed to load stored themes', { brandId, err });
    return { suggestions: [], userThemeCount: 0 };
  }
}

function buildTopicContribution(topics: Array<{ value?: string; count?: number }>) {
  const contribution = new Map<string, Map<string, number>>();
  for (const topic of topics.slice(0, 50)) {
    if (!topic?.value) {
      continue;
    }
    const candidates = canonicalizeTopic(topic.value);
    for (const candidate of candidates) {
      const key = normalize(candidate);
      const inner = contribution.get(key) || new Map<string, number>();
      const normalizedTopic = normalize(topic.value);
      inner.set(
        normalizedTopic,
        (inner.get(normalizedTopic) || 0) + Math.max(1, Number(topic.count) || 1)
      );
      contribution.set(key, inner);
    }
  }
  return contribution;
}

function buildProfileSuggestions(params: {
  topics: Array<{ value?: string; count?: number }>;
  performanceByTheme: Map<string, number>;
  topicContribution: Map<string, Map<string, number>>;
}) {
  const suggestions: ThemeSuggestion[] = [];
  if (params.topics.length === 0) {
    return suggestions;
  }

  const normalizedTopics = params.topics
    .filter(
      (topic): topic is { value: string; count?: number } =>
        typeof topic?.value === 'string' && topic.value.trim().length > 0
    )
    .map((topic) => ({
      value: topic.value,
      count: typeof topic.count === 'number' ? topic.count : 1,
    }));
  if (normalizedTopics.length === 0) {
    return suggestions;
  }

  const canon = classifyTopicsToCanonical(normalizedTopics, { maxResults: 30 });
  for (const item of canon) {
    const value = normalize(item.value);
    const base = Math.max(0.1, item.score);
    const perf = params.performanceByTheme.get(value) || 0;
    const perfBoost = perf > 0 ? Math.min(0.2, perf * 0.4) : 0;
    const reasons: string[] = [];
    const contributions = params.topicContribution.get(value);

    if (contributions?.size) {
      const top = Array.from(contributions.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name]) => name);
      if (top.length) {
        reasons.push(`Topics: ${top.join(', ')}`);
      }
    }
    if (perfBoost > 0) {
      reasons.push(`Performance +${Math.round(perf * 100)}% vs avg`);
    }
    reasons.push('Source: brand topics');

    suggestions.push({
      value,
      score: Math.min(1, base + perfBoost),
      source: 'profile',
      perfDelta: perf,
      reasons,
    });
  }

  return suggestions;
}

function buildHeuristicSuggestions(
  tones: string[],
  performanceByTheme: Map<string, number>
): ThemeSuggestion[] {
  const suggestions: ThemeSuggestion[] = [];
  for (const tone of tones.slice(0, 10)) {
    const normalizedTone = normalize(tone);
    if (!normalizedTone) {
      continue;
    }

    const implied: string[] = [];
    if (/playful|fun|casual/.test(normalizedTone)) {
      implied.push('behind the scenes', 'memes & trends');
    }
    if (/professional|authoritative|expert|thoughtful/.test(normalizedTone)) {
      implied.push('industry insights');
    }
    if (/inspir/.test(normalizedTone)) {
      implied.push('customer stories');
    }

    for (const theme of implied) {
      const key = normalize(theme);
      const perf = performanceByTheme.get(key) || 0;
      const perfBoost = perf > 0 ? Math.min(0.2, perf * 0.4) : 0;
      const reasons: string[] = [`Tone: ${tone}`];
      if (perfBoost > 0) {
        reasons.push(`Performance +${Math.round(perf * 100)}% vs avg`);
      }
      reasons.push('Source: tone heuristic');
      suggestions.push({
        value: key,
        score: Math.min(0.8, 0.35 + perfBoost),
        source: 'heuristic',
        perfDelta: perf,
        reasons,
      });
    }
  }
  return suggestions;
}

function dedupeSuggestions(suggestions: ThemeSuggestion[]) {
  const best = new Map<string, ThemeSuggestion>();
  for (const suggestion of suggestions) {
    const key = normalize(suggestion.value);
    const existing = best.get(key);
    if (!existing || suggestion.score > existing.score) {
      best.set(key, { ...suggestion, value: key });
    }
  }
  return Array.from(best.values()).sort((a, b) => b.score - a.score);
}

function applyFallbackSuggestions(params: {
  suggestions: ThemeSuggestion[];
  limit: number;
  performanceByTheme: Map<string, number>;
}) {
  if (params.suggestions.length >= Math.min(4, params.limit)) {
    return params.suggestions;
  }

  const fallback = FALLBACK_THEMES.map((value, index) => {
    const key = normalize(value);
    const perf = params.performanceByTheme.get(key) || 0;
    const perfBoost = perf > 0 ? Math.min(0.15, perf * 0.3) : 0;
    return {
      value: key,
      score: 0.28 - index * 0.02 + perfBoost,
      source: 'fallback' as const,
      perfDelta: perf,
      reasons: [
        'Source: defaults',
        perfBoost > 0 ? `Performance +${Math.round(perf * 100)}% vs avg` : undefined,
      ].filter(Boolean) as string[],
    };
  });

  const seen = new Set(params.suggestions.map((suggestion) => suggestion.value));
  const merged = [...params.suggestions];
  for (const item of fallback) {
    if (!seen.has(item.value)) {
      merged.push(item);
    }
  }
  return merged;
}

export async function suggestThemes(params: {
  brandId: string;
  limit?: number;
}): Promise<{ suggestions: ThemeSuggestion[] }> {
  const { brandId, limit = 8 } = params;
  const ctx = await getBrandProfileContext(brandId);
  const prisma = getDatabaseClient();
  const performanceByTheme = await computeThemePerformance(prisma, brandId);
  const topics = Array.isArray(ctx?.topicsTop)
    ? (ctx.topicsTop as Array<{ value?: string; count?: number }>)
    : [];
  const tones = Array.isArray(ctx?.tones)
    ? (ctx.tones as string[]).filter((tone): tone is string => typeof tone === 'string')
    : [];

  const { suggestions: userSuggestions, userThemeCount } = await loadUserThemeSuggestions(
    prisma,
    brandId
  );
  const topicContribution = buildTopicContribution(topics);
  const profileSuggestions = buildProfileSuggestions({
    topics,
    performanceByTheme,
    topicContribution,
  });
  const heuristicSuggestions = buildHeuristicSuggestions(tones, performanceByTheme);

  const deduped = dedupeSuggestions([
    ...userSuggestions,
    ...profileSuggestions,
    ...heuristicSuggestions,
  ]);
  const withFallback = applyFallbackSuggestions({
    suggestions: deduped,
    limit,
    performanceByTheme,
  });

  return { suggestions: clampSuggestions(withFallback, limit, userThemeCount) };
}
