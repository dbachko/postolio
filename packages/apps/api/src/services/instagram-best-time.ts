import axios from 'axios';
import { logger as baseLogger } from '@postolio/logger';
import { getDatabaseClient } from '../config/database.js';
import { redisService } from './redis.js';
import { TimezoneService } from './timezone.js';
import { PublisherCredentialsService } from './publisher-credentials.js';
import { formatError } from '../utils/logging.js';

const prisma = getDatabaseClient();
const bestTimeLogger = baseLogger.child({ module: 'instagram-best-time' });

type Heatmap = number[][]; // 7 rows (Sun..Sat), 24 cols (0..23)

export interface BestTimePayload {
  brandId: string;
  platform: 'instagram';
  timezone: string;
  source: 'instagram_insights' | 'history' | 'heuristic';
  confidence: number; // 0..1
  generatedAt: string; // ISO
  ttlSeconds: number;
  heatmap: Heatmap;
  topWindows: Array<{
    startLocal: string; // ISO with offset
    startUTC: string; // ISO UTC
    durationMinutes: number;
    score: number; // 0..1
    explanation?: string;
  }>;
  notes?: string[];
}

const CACHE_PREFIX = 'ig_best_time:';
const DEFAULT_TTL = parseInt(process.env.BEST_TIME_TTL_SECONDS || '86400', 10); // 24h
const FB_GRAPH_API_VERSION = process.env.FB_GRAPH_API_VERSION || 'v24.0';
const DEFAULT_SLOTS_PER_DAY = parseInt(process.env.BEST_TIME_SLOTS_PER_DAY || '2', 10);
const DEFAULT_MIN_GAP_HOURS = parseInt(process.env.BEST_TIME_MIN_GAP_HOURS || '1', 10);
const DEFAULT_WINDOW_MINUTES = parseInt(process.env.BEST_TIME_WINDOW_MINUTES || '30', 10);

function getGraphError(err: unknown): {
  code?: number;
  subcode?: number;
  type?: string;
  message?: string;
  fbtraceId?: string;
} | null {
  const maybeAny = err as any;
  const graphError = maybeAny?.response?.data?.error;
  if (!graphError || typeof graphError !== 'object') {
    return null;
  }

  return {
    code: typeof graphError.code === 'number' ? graphError.code : undefined,
    subcode: typeof graphError.error_subcode === 'number' ? graphError.error_subcode : undefined,
    type: typeof graphError.type === 'string' ? graphError.type : undefined,
    message: typeof graphError.message === 'string' ? graphError.message : undefined,
    fbtraceId: typeof graphError.fbtrace_id === 'string' ? graphError.fbtrace_id : undefined,
  };
}

function getInsightsUnavailableNote(err: unknown): string {
  const graphError = getGraphError(err);
  const msg = (graphError?.message || '').toLowerCase();

  // Meta may require a minimum follower count before returning `online_followers`.
  // Be careful: many Graph API errors use "(#100)" for invalid params, so do not
  // infer follower thresholds from "100" alone.
  if (
    msg.includes('followers') &&
    (msg.includes('100 followers') || (msg.includes('at least 100') && msg.includes('followers')))
  ) {
    return 'Insights unavailable: requires ≥100 followers for `online_followers`';
  }

  if (msg.includes('incompatible') && msg.includes('metric') && msg.includes('type')) {
    return 'Insights unavailable: Instagram Graph API rejected the request parameters';
  }

  // Meta often reports missing scopes as OAuth/permission errors.
  if (
    graphError?.code === 10 ||
    msg.includes('permissions error') ||
    msg.includes('permission') ||
    msg.includes('requires') ||
    msg.includes('scope')
  ) {
    return 'Insights unavailable: missing `instagram_manage_insights` permission (reconnect Instagram)';
  }

  return 'Insights unavailable: Instagram Graph API error';
}

function emptyHeatmap(): Heatmap {
  return Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
}

function normalizeHeatmap(hm: Heatmap): Heatmap {
  let max = 0;
  for (const row of hm) {
    for (const v of row) {
      if (v > max) {
        max = v;
      }
    }
  }
  if (max <= 0) {
    return hm.map((r) => r.map(() => 0));
  }
  return hm.map((r) => r.map((v) => +(v / max).toFixed(4)));
}

function smoothHeatmap(hm: Heatmap): Heatmap {
  const rows = 7;
  const cols = 24;
  const out = emptyHeatmap();
  for (let d = 0; d < rows; d++) {
    for (let h = 0; h < cols; h++) {
      let sum = 0;
      let count = 0;
      for (let dd = -1; dd <= 1; dd++) {
        for (let hh = -1; hh <= 1; hh++) {
          const rd = (d + dd + rows) % rows;
          const ch = (h + hh + cols) % cols;
          sum += hm[rd][ch];
          count++;
        }
      }
      out[d][h] = sum / count;
    }
  }
  return out;
}

function smoothHeatmapHoursOnly(hm: Heatmap): Heatmap {
  const out = emptyHeatmap();
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const prev = hm[d][(h + 23) % 24];
      const curr = hm[d][h];
      const next = hm[d][(h + 1) % 24];
      out[d][h] = (prev + 2 * curr + next) / 4;
    }
  }
  return out;
}

function parseOnlineFollowersDayValue(value: Record<string, number> | number[]): number[] | null {
  if (Array.isArray(value) && value.length >= 24) {
    return Array.from({ length: 24 }, (_, h) => Number(value[h] ?? 0));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, number>;
    return Array.from({ length: 24 }, (_, h) => Number(obj[String(h)] ?? 0));
  }
  return null;
}

export class InstagramBestTimeService {
  private key(brandId: string) {
    return `${CACHE_PREFIX}${brandId}`;
  }

  async getRecommendations(
    brandId: string,
    force = false,
    topWindowsLimit?: number
  ): Promise<BestTimePayload> {
    const brand = await prisma.brand.findUnique({
      where: { id: brandId },
      select: {
        id: true,
        userId: true,
        socialAccounts: {
          where: { platform: 'instagram' },
          select: {
            externalAccountId: true,
            externalPageId: true,
          },
          take: 1,
        },
      },
    });
    if (!brand) {
      throw new Error('Brand not found');
    }
    const instagramAccount = brand.socialAccounts?.[0];
    if (!instagramAccount) {
      throw new Error('Instagram account not connected');
    }

    const timezone = await TimezoneService.getBrandTimezone(brandId);
    const cacheKey = this.key(brandId);

    if (!force) {
      const cached = await redisService.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as BestTimePayload;
        return this.applyTopWindowsLimit(parsed, topWindowsLimit);
      }
    }

    // Try insights → history → heuristic
    let payload: BestTimePayload | null = null;
    const fallbackNotes: string[] = [];
    try {
      payload = await this.computeFromInsights(brandId, timezone);
      if (!payload) {
        fallbackNotes.push(
          'Insights unavailable: no `online_followers` data returned (Meta may require ≥100 followers)'
        );
      }
    } catch (err) {
      // Log and continue to next strategy; insights may be unavailable
      // (e.g., <100 followers or missing permissions)
      const graphError = getGraphError(err);
      fallbackNotes.push(getInsightsUnavailableNote(err));
      bestTimeLogger.warn('computeFromInsights failed; falling back', {
        brandId,
        graphError,
        ...formatError(err),
      });
    }
    if (!payload) {
      try {
        payload = await this.computeFromHistory(brandId, timezone);
      } catch (err) {
        // Log and fall back to heuristic if history is insufficient or errors occur
        bestTimeLogger.warn('computeFromHistory failed; falling back', {
          brandId,
          ...formatError(err),
        });
      }
    }
    if (!payload) {
      payload = this.computeHeuristic(brandId, timezone);
    }

    if (fallbackNotes.length) {
      payload.notes = [...(payload.notes || []), ...fallbackNotes];
    }

    // Cache result
    await redisService.set(cacheKey, JSON.stringify(payload), payload.ttlSeconds);
    return this.applyTopWindowsLimit(payload, topWindowsLimit);
  }

  private applyTopWindowsLimit(
    payload: BestTimePayload,
    topWindowsLimit?: number
  ): BestTimePayload {
    const limit =
      typeof topWindowsLimit === 'number' && Number.isFinite(topWindowsLimit)
        ? Math.floor(topWindowsLimit)
        : undefined;
    if (!limit || limit <= 0) {
      return payload;
    }
    return {
      ...payload,
      topWindows: payload.topWindows.slice(0, limit),
      notes:
        limit < payload.topWindows.length
          ? [...(payload.notes || []), `Top windows truncated to ${limit}`]
          : payload.notes,
    };
  }

  private async computeFromInsights(
    brandId: string,
    timezone: string
  ): Promise<BestTimePayload | null> {
    // Get credentials
    const credentials = await PublisherCredentialsService.getCredentialsForBrand(brandId);
    if (!credentials?.accessToken || !credentials.accountId) {
      throw new Error('Missing Instagram credentials');
    }

    // Call IG insights API for online_followers (v24.0)
    const url = `https://graph.facebook.com/${FB_GRAPH_API_VERSION}/${credentials.accountId}/insights`;
    const params = new URLSearchParams({
      metric: 'online_followers',
      period: 'lifetime',
      access_token: credentials.accessToken,
    });

    const resp = await axios.get(`${url}?${params.toString()}`);
    type InsightValueItem = { end_time?: string; value: Record<string, number> | number[] };
    type InsightMetricEntry = { name: string; values?: InsightValueItem[] };
    const data: InsightMetricEntry[] | undefined = resp.data?.data;
    if (!Array.isArray(data) || data.length === 0) {
      // insights may be unavailable (e.g., <100 followers)
      return null;
    }

    // Attempt to parse various shapes of online_followers values
    // Shape A: values: [ { end_time, value: { '0': 123, ..., '23': 456 } }, ...]
    // Shape B: values: [ { end_time, value: [n0..n23] }, ...]
    const entry = data.find((d) => d.name === 'online_followers') || data[0];
    const values = entry?.values as InsightValueItem[] | undefined;
    if (!Array.isArray(values) || values.length === 0) {
      return null;
    }

    // Build weekday heatmap using end_time to group values by day-of-week.
    // `end_time` is the end of the period; subtract a small delta to land inside that day.
    const hm = emptyHeatmap();
    const counts = emptyHeatmap();

    const overallHours = Array.from({ length: 24 }, () => 0);
    let overallCountDays = 0;

    for (const v of values) {
      const parsed = parseOnlineFollowersDayValue(v?.value);
      if (!parsed) {
        continue;
      }

      for (let h = 0; h < 24; h++) {
        overallHours[h] += parsed[h];
      }
      overallCountDays++;

      if (!v?.end_time) {
        continue;
      }
      const endTime = new Date(v.end_time);
      if (Number.isNaN(endTime.getTime())) {
        continue;
      }
      const local = TimezoneService.toLocal(new Date(endTime.getTime() - 1000), timezone);
      const day = local.getDay(); // 0=Sun..6=Sat

      for (let h = 0; h < 24; h++) {
        hm[day][h] += parsed[h];
        counts[day][h] += 1;
      }
    }

    if (overallCountDays === 0) {
      return null;
    }
    for (let h = 0; h < 24; h++) {
      overallHours[h] = overallHours[h] / overallCountDays;
    }

    // Average per weekday bucket; fill missing weekdays with the overall profile.
    for (let d = 0; d < 7; d++) {
      let hasAny = false;
      for (let h = 0; h < 24; h++) {
        if (counts[d][h] > 0) {
          hm[d][h] = hm[d][h] / counts[d][h];
          hasAny = true;
        }
      }
      if (!hasAny) {
        for (let h = 0; h < 24; h++) {
          hm[d][h] = overallHours[h];
        }
      }
    }

    // Smooth within the day only to avoid washing out weekday differences.
    const smoothed = smoothHeatmapHoursOnly(hm);
    const normalized = normalizeHeatmap(smoothed);
    const top = this.rankTopWindows(normalized, timezone);

    const payload: BestTimePayload = {
      brandId,
      platform: 'instagram',
      timezone,
      source: 'instagram_insights',
      confidence: 0.85,
      generatedAt: new Date().toISOString(),
      ttlSeconds: DEFAULT_TTL,
      heatmap: normalized,
      topWindows: top,
      notes: ['Insights-based', 'Averaged across last 30 days by weekday', 'Smoothed (hours only)'],
    };
    payload.notes = [
      ...(payload.notes || []),
      `Top windows: ${Math.max(1, DEFAULT_SLOTS_PER_DAY)}/day, ≥${Math.max(1, DEFAULT_MIN_GAP_HOURS)}h apart`,
    ];
    return payload;
  }

  private async computeFromHistory(
    brandId: string,
    timezone: string
  ): Promise<BestTimePayload | null> {
    const since = new Date();
    since.setDate(since.getDate() - 90);
    const rows = await prisma.contentPublication.findMany({
      where: {
        content: { brandId },
        publishedAt: { not: null, gte: since },
      },
      select: {
        publishedAt: true,
        metricsLatest: { select: { likes: true, comments: true, reach: true } },
      },
      orderBy: { publishedAt: 'desc' },
      take: 500,
    });
    if (!rows.length) {
      return null;
    }

    const hm = emptyHeatmap();
    const counts = emptyHeatmap();

    for (const r of rows) {
      if (!r.publishedAt) {
        continue;
      }
      const local = TimezoneService.toLocal(r.publishedAt, timezone);
      const day = local.getDay(); // 0=Sun..6=Sat
      const hour = local.getHours();
      const m = r.metricsLatest || { likes: 0, comments: 0, reach: 0 };
      const likes = Number(m.likes || 0);
      const comments = Number(m.comments || 0);
      const reach = Number(m.reach || 0);
      // Engagement score formula:
      // - Comments are weighted 2x compared to likes because they indicate deeper interaction.
      // - Reach uses sqrt to dampen outliers so viral posts do not dominate the signal.
      const score = (likes + 2 * comments) * (reach > 0 ? Math.sqrt(reach) : 1);
      hm[day][hour] += score;
      counts[day][hour] += 1;
    }
    // Average per bucket and smooth/normalize
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        if (counts[d][h] > 0) {
          hm[d][h] = hm[d][h] / counts[d][h];
        }
      }
    }

    // If very sparse, back off to daypart (morning/afternoon/evening) by distributing
    let nonZeroBuckets = 0;
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        if (hm[d][h] > 0) {
          nonZeroBuckets++;
        }
      }
    }
    if (nonZeroBuckets < 10) {
      const dayparts = [
        [6, 11],
        [12, 17],
        [18, 22],
      ];
      const hm2 = emptyHeatmap();
      for (let d = 0; d < 7; d++) {
        for (const [s, e] of dayparts) {
          let sum = 0,
            cnt = 0;
          for (let h = s; h <= e; h++) {
            sum += hm[d][h];
            cnt++;
          }
          const avg = cnt ? sum / cnt : 0;
          for (let h = s; h <= e; h++) {
            hm2[d][h] = avg;
          }
        }
      }
      for (let d = 0; d < 7; d++) {
        for (let h = 0; h < 24; h++) {
          if (hm2[d][h] === 0) {
            hm2[d][h] = hm[d][h];
          }
        }
      }
      for (let d = 0; d < 7; d++) {
        hm[d] = hm2[d];
      }
    }

    const smoothed = smoothHeatmap(hm);
    const normalized = normalizeHeatmap(smoothed);
    const top = this.rankTopWindows(normalized, timezone);

    return {
      brandId,
      platform: 'instagram',
      timezone,
      source: 'history',
      // Confidence is based on the amount of recent historical data:
      // - Start at 0.5 (minimum reasonable confidence)
      // - +0.001 per post over the last 90 days (rows.length / 1000)
      // - Cap at 0.85 to avoid overconfidence and keep parity with insights-based results
      confidence: Math.min(0.85, 0.5 + rows.length / 1000),
      generatedAt: new Date().toISOString(),
      ttlSeconds: DEFAULT_TTL,
      heatmap: normalized,
      topWindows: top,
      notes: [
        'History-based',
        `Sample=${rows.length}`,
        'Weighted likes + comments (+reach)',
        `Top windows: ${Math.max(1, DEFAULT_SLOTS_PER_DAY)}/day, ≥${Math.max(1, DEFAULT_MIN_GAP_HOURS)}h apart`,
      ],
    };
  }

  private computeHeuristic(brandId: string, timezone: string): BestTimePayload {
    // Simple default: late morning and early evening preference
    const hm = emptyHeatmap();
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        let base = 0.3;
        if ((h >= 10 && h <= 12) || (h >= 18 && h <= 20)) {
          base = 1.0;
        } else if ((h >= 8 && h <= 9) || (h >= 21 && h <= 22)) {
          base = 0.6;
        }
        hm[d][h] = base;
      }
    }
    const smoothed = smoothHeatmap(hm);
    const normalized = normalizeHeatmap(smoothed);
    const top = this.rankTopWindows(normalized, timezone);
    return {
      brandId,
      platform: 'instagram',
      timezone,
      source: 'heuristic',
      confidence: 0.5,
      generatedAt: new Date().toISOString(),
      ttlSeconds: DEFAULT_TTL,
      heatmap: normalized,
      topWindows: top,
      notes: [
        'Heuristic defaults',
        `Top windows: ${Math.max(1, DEFAULT_SLOTS_PER_DAY)}/day, ≥${Math.max(1, DEFAULT_MIN_GAP_HOURS)}h apart`,
      ],
    };
  }

  private rankTopWindows(
    heatmap: Heatmap,
    timezone: string,
    windowMinutes = DEFAULT_WINDOW_MINUTES,
    topN = DEFAULT_SLOTS_PER_DAY * 7
  ) {
    const slotsPerDay = Math.max(1, DEFAULT_SLOTS_PER_DAY);
    const minGapHours = Math.max(1, DEFAULT_MIN_GAP_HOURS);
    const minGapMinutes = minGapHours * 60;
    const targetCount = Math.max(1, topN);

    type Candidate = {
      day: number;
      hour: number;
      minute: number;
      minuteOfDay: number;
      score: number;
    };

    const dayHourRanks: Candidate[][] = [];
    for (let d = 0; d < 7; d++) {
      const hours: Candidate[] = [];
      for (let h = 0; h < 24; h++) {
        const scoreOnHour = heatmap[d][h];
        const nextHour = heatmap[d][(h + 1) % 24];
        const scoreHalfHour = (scoreOnHour + nextHour) / 2;

        hours.push({
          day: d,
          hour: h,
          minute: 0,
          minuteOfDay: h * 60,
          score: scoreOnHour,
        });
        hours.push({
          day: d,
          hour: h,
          minute: 30,
          minuteOfDay: h * 60 + 30,
          score: +scoreHalfHour.toFixed(4),
        });
      }
      hours.sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        if (a.minute !== b.minute) {
          return b.minute - a.minute;
        } // prefer :30 over :00 when tied
        return a.hour - b.hour;
      });
      dayHourRanks[d] = hours;
    }

    const pickedByDay = new Map<number, Candidate[]>();
    const usedHoursGlobal = new Set<number>();

    const isTooClose = (minuteA: number, minuteB: number) => {
      const diff = Math.abs(minuteA - minuteB);
      return Math.min(diff, 24 * 60 - diff) < minGapMinutes;
    };

    const pickForDay = (day: number, preferUnusedGlobalHour: boolean): Candidate | null => {
      const already = pickedByDay.get(day) || [];
      const ranks = dayHourRanks[day] || [];
      for (const c of ranks) {
        if (preferUnusedGlobalHour && usedHoursGlobal.has(c.hour)) {
          continue;
        }
        if (already.some((p) => isTooClose(p.minuteOfDay, c.minuteOfDay))) {
          continue;
        }
        return c;
      }
      if (!preferUnusedGlobalHour) {
        return null;
      }
      // Relax global uniqueness if needed.
      for (const c of ranks) {
        if (already.some((p) => isTooClose(p.minuteOfDay, c.minuteOfDay))) {
          continue;
        }
        return c;
      }
      return null;
    };

    // Pass 1: pick a primary time for each day, preferring distinct hours globally.
    const dayBest = Array.from({ length: 7 }, (_, d) => ({ day: d, best: dayHourRanks[d]?.[0] }))
      .filter((x) => x.best)
      .sort((a, b) => (b.best?.score ?? 0) - (a.best?.score ?? 0));

    for (const { day } of dayBest) {
      const chosen = pickForDay(day, true);
      if (!chosen) {
        continue;
      }
      pickedByDay.set(day, [chosen]);
      usedHoursGlobal.add(chosen.hour);
    }

    // Pass 2: add additional slots per day (spaced by minGapHours).
    for (let slot = 2; slot <= slotsPerDay; slot++) {
      for (let day = 0; day < 7; day++) {
        const chosen = pickForDay(day, false);
        if (!chosen) {
          continue;
        }
        const list = pickedByDay.get(day) || [];
        list.push(chosen);
        pickedByDay.set(day, list);
      }
    }

    const picked = Array.from(pickedByDay.values())
      .flat()
      .sort((a, b) => b.score - a.score)
      .slice(0, targetCount);

    // Format output with local and UTC start times on the upcoming week reference
    const now = new Date();
    const sunday = new Date(now);
    sunday.setDate(now.getDate() - now.getDay()); // set to start of week (Sun)
    sunday.setHours(0, 0, 0, 0);

    return picked.map((p) => {
      const localStart = new Date(sunday);
      localStart.setDate(sunday.getDate() + p.day);
      localStart.setHours(p.hour, p.minute, 0, 0);
      // Build ISO in local TZ via TimezoneService formatting and also UTC
      const utc = TimezoneService.toUTC(localStart, timezone);
      const startUTC = utc.toISOString();
      // Create an ISO with timezone offset using toLocaleString may be messy; keep UTC + note
      const startLocal = TimezoneService.formatWithTimezone(utc, timezone, "yyyy-MM-dd'T'HH:mmXXX");
      return {
        startLocal,
        startUTC,
        durationMinutes: windowMinutes,
        score: +p.score.toFixed(4),
        explanation: undefined,
      };
    });
  }
}

export const instagramBestTimeService = new InstagramBestTimeService();
