import { getBrandProfileContext } from './brand-profile.js';
import { classifyTopicsToCanonical, canonicalizeTopic } from '@postolio/taxonomy';
import { getDatabaseClient } from '../config/database.js';

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

export async function suggestThemes(params: {
  brandId: string;
  limit?: number;
}): Promise<{ suggestions: ThemeSuggestion[] }> {
  const { brandId, limit = 8 } = params;

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
      if (engagement <= 0) {
        continue;
      }
      const set = new Set<string>();
      for (const h of p.content?.hashtags || []) {
        const clean = String(h || '').replace(/^#/, '');
        for (const canon of canonicalizeTopic(clean)) {
          set.add(canon);
        }
      }
      if (p.content?.caption) {
        for (const canon of canonicalizeTopic(p.content.caption)) {
          set.add(canon);
        }
      }
      if (set.size > 0) {
        metrics.push({ value: engagement, themes: Array.from(set) });
      }
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
  let userThemeCount = 0;

  // 1) Primary: derive from brand profile topics -> canonical themes
  const topics = Array.isArray(ctx?.topicsTop) ? ctx!.topicsTop! : [];
  // 0) User-saved themes (highest priority)
  try {
    const brand = await prisma.brand.findUnique({
      where: { id: brandId },
      select: { preferences: true },
    });
    const storedThemes = extractStoredThemes(brand?.preferences);
    userThemeCount = storedThemes.length;
    storedThemes.forEach((value, index) => {
      out.push({
        value: normalize(value),
        score: 1 - index * 0.01,
        source: 'user',
        reasons: ['Saved from your previous posts'],
      });
    });
  } catch (err) {
    console.error('Failed to load stored themes', { brandId, err });
  }

  // Track contributions: which raw topics map to each canonical theme
  const topicContribution = new Map<string, Map<string, number>>();
  if (topics.length > 0) {
    for (const t of topics.slice(0, 50)) {
      if (!t?.value) {
        continue;
      }
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
      const score = Math.min(1, base + perfBoost);
      const reasons: string[] = [];
      const contrib = topicContribution.get(v);
      if (contrib?.size) {
        const top = Array.from(contrib.entries())
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
      out.push({ value: v, score, source: 'profile', perfDelta: perf, reasons });
    }
  }

  // 2) Heuristics: tones implying themes
  const tones = Array.isArray(ctx?.tones) ? ctx!.tones : [];
  for (const tone of tones.slice(0, 10)) {
    const v = normalize(tone);
    if (!v) {
      continue;
    }
    const implied: string[] = [];
    if (/playful|fun|casual/.test(v)) {
      implied.push('behind the scenes', 'memes & trends');
    }
    if (/professional|authoritative|expert|thoughtful/.test(v)) {
      implied.push('industry insights');
    }
    if (/inspir/.test(v)) {
      implied.push('customer stories');
    }
    for (const theme of implied) {
      const k = normalize(theme);
      const perf = performanceByTheme.get(k) || 0;
      const perfBoost = perf > 0 ? Math.min(0.2, perf * 0.4) : 0;
      const s = 0.35 + perfBoost;
      const reasons: string[] = [`Tone: ${tone}`];
      if (perfBoost > 0) {
        reasons.push(`Performance +${Math.round(perf * 100)}% vs avg`);
      }
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
    if (!existing || s.score > existing.score) {
      best.set(key, { ...s, value: key });
    }
  }
  let suggestions = Array.from(best.values()).sort((a, b) => b.score - a.score);

  // 3) Fallbacks if insufficient data
  if (suggestions.length < Math.min(4, limit)) {
    const fb = FALLBACK_THEMES.map((v, i) => {
      const k = normalize(v);
      const perf = performanceByTheme.get(k) || 0;
      const perfBoost = perf > 0 ? Math.min(0.15, perf * 0.3) : 0;
      return {
        value: k,
        score: 0.28 - i * 0.02 + perfBoost,
        source: 'fallback' as const,
        perfDelta: perf,
        reasons: [
          'Source: defaults',
          perfBoost > 0 ? `Performance +${Math.round(perf * 100)}% vs avg` : undefined,
        ].filter(Boolean) as string[],
      };
    });
    const seen = new Set(suggestions.map((s) => s.value));
    for (const f of fb) {
      if (!seen.has(f.value)) {
        suggestions.push(f);
      }
    }
  }

  // limit and return (ensure user themes are always included)
  const maxResults = Math.max(limit, userThemeCount);
  suggestions = suggestions
    .filter((s) => s.value && s.value.length >= 2)
    .slice(0, Math.max(1, Math.min(16, maxResults || limit)));

  return { suggestions };
}
