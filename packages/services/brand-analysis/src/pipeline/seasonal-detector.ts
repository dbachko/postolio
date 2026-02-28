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

function collectPostTokens(post: MinimalPost): Set<string> {
  const tokens = new Set<string>();
  if (post.caption) {
    for (const token of normalizeTokens(post.caption)) {
      tokens.add(token);
    }
  }

  for (const hashtag of post.hashtags || []) {
    for (const token of normalizeTokens(hashtag)) {
      tokens.add(token);
    }
  }

  return tokens;
}

function findBestSeasonalKeywordLabel(tokens: Set<string>): string | undefined {
  let best: { label: string; hits: number } | undefined;
  for (const [label, keywords] of Object.entries(SEASONAL_KEYWORDS)) {
    const hits = keywords.reduce((acc, keyword) => acc + (tokens.has(keyword) ? 1 : 0), 0);
    if (hits > 0 && (!best || hits > best.hits)) {
      best = { label, hits };
    }
  }

  return best?.label;
}

function inferCalendarSeasonalLabel(post: MinimalPost, countryCode?: string): string | undefined {
  if (!post.timestamp || !countryCode) {
    return undefined;
  }

  const date = new Date(post.timestamp);
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const market = countryCode.toUpperCase();
  const events = PER_MARKET_CALENDAR[market];
  if (!events?.length) {
    return undefined;
  }

  for (const event of events) {
    if (event.month !== month || !event.day) {
      continue;
    }

    const diff = Math.abs(day - event.day);
    if (diff <= (event.windowDays || 3)) {
      return event.label;
    }
  }

  return undefined;
}

function inferSeasonalLabel(post: MinimalPost, countryCode?: string): string | undefined {
  const keywordLabel = findBestSeasonalKeywordLabel(collectPostTokens(post));
  if (keywordLabel) {
    return keywordLabel;
  }

  return inferCalendarSeasonalLabel(post, countryCode);
}

function isExcludedFromCore(p: MinimalPost): boolean {
  if (p.generated === true) {
    return true;
  }
  if (typeof p.generated_by === 'string' && p.generated_by.length > 0) {
    return true;
  }
  if (typeof p.origin === 'string' && /postolio/i.test(p.origin)) {
    return true;
  }
  if (typeof p.caption === 'string' && /postolio/i.test(p.caption)) {
    return true;
  }
  return false;
}

type PostBuckets = {
  seasonalBuckets: Record<string, MinimalPost[]>;
  seasonalPosts: MinimalPost[];
  trendingPosts: MinimalPost[];
  coreCandidates: MinimalPost[];
};

function addPostToBuckets(
  post: MinimalPost,
  label: string | undefined,
  isTrending: boolean,
  buckets: PostBuckets
): void {
  if (label) {
    buckets.seasonalPosts.push(post);
    buckets.seasonalBuckets[label] = buckets.seasonalBuckets[label] || [];
    buckets.seasonalBuckets[label].push(post);
    return;
  }

  if (isTrending) {
    buckets.trendingPosts.push(post);
  }

  buckets.coreCandidates.push(post);
}

function resolveDominantSeasonality(
  seasonalBuckets: Record<string, MinimalPost[]>,
  minSeasonal: number,
  now: number,
  ttlDays: number
): { seasonalLabel?: string; seasonalExpiresAt?: string } {
  const dominant = Object.entries(seasonalBuckets)
    .map(([label, posts]) => ({ label, count: posts.length }))
    .sort((a, b) => b.count - a.count)[0];
  if (!dominant || dominant.count < minSeasonal) {
    return {};
  }

  return {
    seasonalLabel: dominant.label,
    seasonalExpiresAt: new Date(now + ttlDays * 24 * 60 * 60 * 1000).toISOString(),
  };
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
    addPostToBuckets(p, label, isTrending, {
      seasonalBuckets,
      seasonalPosts,
      trendingPosts,
      coreCandidates,
    });
  }

  const { seasonalLabel, seasonalExpiresAt } = resolveDominantSeasonality(
    seasonalBuckets,
    minSeasonal,
    now,
    ttlDays
  );

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
