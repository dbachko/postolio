export type ClassifyOptions = {
  seasonalTtlDays?: number;
  minSeasonalPosts?: number;
  countryCode?: string;
};

export type MinimalPost = {
  id?: string;
  caption?: string;
  hashtags?: string[];
  timestamp?: string;
  media_type?: string;
  media_url?: string;
  // Optional metadata that upstream APIs may provide
  origin?: string;
  generated?: boolean;
  generated_by?: string;
};

export type SeasonalClassification = {
  corePosts: MinimalPost[];
  seasonalPosts: MinimalPost[];
  trendingPosts: MinimalPost[];
  excludedPosts: MinimalPost[];
  seasonalLabel?: string;
  seasonalExpiresAt?: string;
  stats: {
    total: number;
    coreCount: number;
    seasonalCount: number;
    trendingCount: number;
    excludedCount: number;
  };
};

const SEASONAL_KEYWORDS: Record<string, string[]> = {
  halloween: ['halloween', 'spooky', 'pumpkin', 'trickortreat', 'trick-or-treat', 'boo'],
  bfcm: ['blackfriday', 'bfcm', 'cybermonday', 'cyberweek'],
  holiday: ['christmas', 'xmas', 'holiday', 'hanukkah', 'kwanzaa', 'newyear'],
  valentines: ['valentine', 'valentines', 'valentinesday', 'loveisintheair'],
  easter: ['easter', 'eastersunday'],
  backtoschool: ['backtoschool'],
  summer: ['summer', 'summervibes'],
  pride: ['pride', 'pridemonth'],
  stpatricks: ['stpatricks', 'stpatricksday', 'shamrock', 'stpaddys'],
  mothersday: ['mothersday', 'mother’sday', 'mothers day'],
  fathersday: ['fathersday', 'father’sday', 'fathers day'],
  diwali: ['diwali', 'deepavali'],
  lunarnewyear: ['lunarnewyear', 'chinesenewyear', 'cny'],
  oktoberfest: ['oktoberfest'],
  thanksgiving: ['thanksgiving', 'turkeyday'],
};

type CalendarEvent = { label: string; month: number; day?: number; windowDays?: number };
const PER_MARKET_CALENDAR: Record<string, CalendarEvent[]> = {
  US: [
    { label: 'thanksgiving', month: 11, day: 25, windowDays: 5 },
    { label: 'holiday', month: 12, day: 25, windowDays: 21 },
    { label: 'stpatricks', month: 3, day: 17, windowDays: 5 },
    { label: 'mothersday', month: 5, day: 12, windowDays: 5 },
    { label: 'fathersday', month: 6, day: 16, windowDays: 5 },
    { label: 'bfcm', month: 11, day: 29, windowDays: 5 },
    { label: 'halloween', month: 10, day: 31, windowDays: 7 },
  ],
  UK: [
    { label: 'holiday', month: 12, day: 25, windowDays: 21 },
    { label: 'bfcm', month: 11, day: 29, windowDays: 5 },
    { label: 'halloween', month: 10, day: 31, windowDays: 7 },
  ],
  DE: [
    { label: 'holiday', month: 12, day: 24, windowDays: 21 },
    { label: 'oktoberfest', month: 9, day: 22, windowDays: 16 },
  ],
  IN: [{ label: 'diwali', month: 11, day: 1, windowDays: 10 }],
  CN: [{ label: 'lunarnewyear', month: 2, day: 10, windowDays: 10 }],
  AU: [{ label: 'holiday', month: 12, day: 25, windowDays: 21 }],
  // Fallback entries can be expanded as needed
};

function normalizeTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[#@]/g, ' ')
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

function inferSeasonalLabel(post: MinimalPost, countryCode?: string): string | undefined {
  const tokens = new Set<string>();
  if (post.caption) for (const t of normalizeTokens(post.caption)) tokens.add(t);
  for (const h of post.hashtags || []) for (const t of normalizeTokens(h)) tokens.add(t);
  let best: { label: string; hits: number } | undefined;
  for (const [label, kws] of Object.entries(SEASONAL_KEYWORDS)) {
    const hits = kws.reduce((acc, kw) => acc + (tokens.has(kw) ? 1 : 0), 0);
    if (hits > 0 && (!best || hits > best.hits)) best = { label, hits };
  }
  if (best?.label) return best.label;
  // Calendar-based heuristic for markets (if no keyword match)
  if (post.timestamp && countryCode) {
    const dt = new Date(post.timestamp);
    const month = dt.getUTCMonth() + 1;
    const day = dt.getUTCDate();
    const market = (countryCode || '').toUpperCase();
    const events = PER_MARKET_CALENDAR[market];
    if (events && events.length > 0) {
      for (const ev of events) {
        if (ev.month !== month) continue;
        if (!ev.day) continue;
        const diff = Math.abs(day - ev.day);
        if (diff <= (ev.windowDays || 3)) return ev.label;
      }
    }
  }
  return undefined;
}

function isExcludedFromCore(p: MinimalPost): boolean {
  if (p.generated === true) return true;
  if (typeof p.generated_by === 'string' && p.generated_by.length > 0) return true;
  if (typeof p.origin === 'string' && /postolio/i.test(p.origin)) return true;
  if (typeof p.caption === 'string' && /postolio/i.test(p.caption)) return true;
  return false;
}

export function classifyPosts(
  posts: MinimalPost[],
  opts: ClassifyOptions = {}
): SeasonalClassification {
  const ttlDays = Math.max(
    1,
    Math.floor(opts.seasonalTtlDays ?? Number(process.env.BRAND_ANALYSIS_SEASONAL_TTL_DAYS || 45))
  );
  const minSeasonal = Math.max(
    1,
    Math.floor(opts.minSeasonalPosts ?? Number(process.env.BRAND_ANALYSIS_MIN_SEASONAL_POSTS || 5))
  );

  const now = Date.now();
  const trendingHorizonMs = 14 * 24 * 60 * 60 * 1000; // 14 days

  const excludedPosts: MinimalPost[] = [];
  const seasonalBuckets: Record<string, MinimalPost[]> = {};
  const seasonalPosts: MinimalPost[] = [];
  const trendingPosts: MinimalPost[] = [];
  const coreCandidates: MinimalPost[] = [];

  for (const p of posts || []) {
    if (isExcludedFromCore(p)) {
      excludedPosts.push(p);
      continue;
    }
    const label = inferSeasonalLabel(p, opts.countryCode);
    const ts = p.timestamp ? Date.parse(p.timestamp) : Number.NaN;
    const isTrending = !Number.isNaN(ts) && now - ts <= trendingHorizonMs;
    if (label) {
      seasonalPosts.push(p);
      seasonalBuckets[label] = seasonalBuckets[label] || [];
      seasonalBuckets[label].push(p);
    } else if (isTrending) {
      trendingPosts.push(p);
      coreCandidates.push(p);
    } else {
      coreCandidates.push(p);
    }
  }

  // Choose dominant seasonal label if any
  let seasonalLabel: string | undefined;
  let seasonalExpiresAt: string | undefined;
  const dominant = Object.entries(seasonalBuckets)
    .map(([label, arr]) => ({ label, count: arr.length }))
    .sort((a, b) => b.count - a.count)[0];
  if (dominant && dominant.count >= minSeasonal) {
    seasonalLabel = dominant.label;
    seasonalExpiresAt = new Date(now + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  }

  return {
    corePosts: coreCandidates,
    seasonalPosts,
    trendingPosts,
    excludedPosts,
    seasonalLabel,
    seasonalExpiresAt,
    stats: {
      total: posts.length,
      coreCount: coreCandidates.length,
      seasonalCount: seasonalPosts.length,
      trendingCount: trendingPosts.length,
      excludedCount: excludedPosts.length,
    },
  };
}
