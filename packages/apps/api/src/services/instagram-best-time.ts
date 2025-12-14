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

function getGraphError(err: unknown): {
  code?: number;
  subcode?: number;
  type?: string;
  message?: string;
  fbtraceId?: string;
} | null {
  const maybeAny = err as any;
  const graphError = maybeAny?.response?.data?.error;
  if (!graphError || typeof graphError !== 'object') return null;

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

  if (msg.includes('followers') && msg.includes('100')) {
    return 'Insights unavailable: requires ≥100 followers for `online_followers`';
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
  for (const row of hm) for (const v of row) if (v > max) max = v;
  if (max <= 0) return hm.map((r) => r.map(() => 0));
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

export class InstagramBestTimeService {
  private key(brandId: string) {
    return `${CACHE_PREFIX}${brandId}`;
  }

  async getRecommendations(brandId: string, force = false): Promise<BestTimePayload> {
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
    if (!brand) throw new Error('Brand not found');
    const instagramAccount = brand.socialAccounts?.[0];
    if (!instagramAccount) throw new Error('Instagram account not connected');

    const timezone = await TimezoneService.getBrandTimezone(brandId);
    const cacheKey = this.key(brandId);

    if (!force) {
      const cached = await redisService.get(cacheKey);
      if (cached) return JSON.parse(cached);
    }

    // Try insights → history → heuristic
    let payload: BestTimePayload | null = null;
    const fallbackNotes: string[] = [];
    try {
      payload = await this.computeFromInsights(brandId, timezone);
      if (!payload) {
        fallbackNotes.push(
          'Insights unavailable: no `online_followers` data (may require ≥100 followers)'
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
    return payload;
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
      metric_type: 'time_series',
      period: 'lifetime',
      access_token: credentials.accessToken,
    });

    const resp = await axios.get(url + '?' + params.toString());
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
    if (!Array.isArray(values) || values.length === 0) return null;

    // Aggregate across days into hour-of-day array
    const hours = Array.from({ length: 24 }, () => 0);
    let countDays = 0;
    for (const v of values) {
      const val = v?.value;
      if (Array.isArray(val) && val.length >= 24) {
        for (let h = 0; h < 24; h++) hours[h] += Number(val[h] ?? 0);
        countDays++;
      } else if (val && typeof val === 'object' && !Array.isArray(val)) {
        const obj = val as Record<string, number>;
        for (let h = 0; h < 24; h++) hours[h] += Number(obj[String(h)] ?? 0);
        countDays++;
      }
    }
    if (countDays === 0) return null;
    // Average per hour
    for (let h = 0; h < 24; h++) hours[h] = hours[h] / countDays;

    // Build heatmap: duplicate hour-of-day pattern across week; then smooth/normalize
    const hm = emptyHeatmap();
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) hm[d][h] = hours[h];
    }
    const smoothed = smoothHeatmap(hm);
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
      notes: ['Insights-based', 'Averaged across last 30 days', 'Smoothed 3×3'],
    };
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
    if (!rows.length) return null;

    const hm = emptyHeatmap();
    const counts = emptyHeatmap();

    for (const r of rows) {
      if (!r.publishedAt) continue;
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
    for (let d = 0; d < 7; d++)
      for (let h = 0; h < 24; h++) if (counts[d][h] > 0) hm[d][h] = hm[d][h] / counts[d][h];

    // If very sparse, back off to daypart (morning/afternoon/evening) by distributing
    let nonZeroBuckets = 0;
    for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) if (hm[d][h] > 0) nonZeroBuckets++;
    if (nonZeroBuckets < 10) {
      const dayparts = [
        [6, 11],
        [12, 17],
        [18, 22],
      ];
      const hm2 = emptyHeatmap();
      for (let d = 0; d < 7; d++)
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
      for (let d = 0; d < 7; d++)
        for (let h = 0; h < 24; h++) if (hm2[d][h] === 0) hm2[d][h] = hm[d][h];
      for (let d = 0; d < 7; d++) hm[d] = hm2[d];
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
      notes: ['History-based', `Sample=${rows.length}`, 'Weighted likes + comments (+reach)'],
    };
  }

  private computeHeuristic(brandId: string, timezone: string): BestTimePayload {
    // Simple default: late morning and early evening preference
    const hm = emptyHeatmap();
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        let base = 0.3;
        if ((h >= 10 && h <= 12) || (h >= 18 && h <= 20)) base = 1.0;
        else if ((h >= 8 && h <= 9) || (h >= 21 && h <= 22)) base = 0.6;
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
      notes: ['Heuristic defaults'],
    };
  }

  private rankTopWindows(heatmap: Heatmap, timezone: string, windowMinutes = 60, topN = 6) {
    // Rank by score; pick highest distinct (day,hour)
    const candidates: Array<{ day: number; hour: number; score: number }> = [];
    for (let d = 0; d < 7; d++)
      for (let h = 0; h < 24; h++) candidates.push({ day: d, hour: h, score: heatmap[d][h] });
    candidates.sort((a, b) => b.score - a.score);

    const picked: typeof candidates = [];
    const used = new Set<string>();
    for (const c of candidates) {
      const key = `${c.day}-${c.hour}`;
      if (used.has(key)) continue;
      picked.push(c);
      used.add(key);
      if (picked.length >= topN) break;
    }

    // Format output with local and UTC start times on the upcoming week reference
    const now = new Date();
    const sunday = new Date(now);
    sunday.setDate(now.getDate() - now.getDay()); // set to start of week (Sun)
    sunday.setHours(0, 0, 0, 0);

    return picked.map((p) => {
      const localStart = new Date(sunday);
      localStart.setDate(sunday.getDate() + p.day);
      localStart.setHours(p.hour, 0, 0, 0);
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
