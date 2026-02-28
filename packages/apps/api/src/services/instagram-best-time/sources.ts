import axios from 'axios';
import { getDatabaseClient } from '../../config/database.js';
import { PublisherCredentialsService } from '../publisher-credentials.js';
import { TimezoneService } from '../timezone.js';
import { rankTopWindows } from './rank-top-windows.js';
import {
  DEFAULT_MIN_GAP_HOURS,
  DEFAULT_SLOTS_PER_DAY,
  DEFAULT_TTL,
  FB_GRAPH_API_VERSION,
  type BestTimePayload,
} from './types.js';
import {
  emptyHeatmap,
  normalizeHeatmap,
  parseOnlineFollowersDayValue,
  smoothHeatmap,
  smoothHeatmapHoursOnly,
} from './utils.js';

const prisma = getDatabaseClient();

function defaultWindowNote(): string {
  return `Top windows: ${Math.max(1, DEFAULT_SLOTS_PER_DAY)}/day, ≥${Math.max(1, DEFAULT_MIN_GAP_HOURS)}h apart`;
}

function buildInsightsHeatmap(
  values: Array<{ end_time?: string; value: Record<string, number> | number[] }>,
  timezone: string
) {
  const hm = emptyHeatmap();
  const counts = emptyHeatmap();
  const overallHours = Array.from({ length: 24 }, () => 0);

  let overallCountDays = 0;
  for (const value of values) {
    const parsed = parseOnlineFollowersDayValue(value?.value);
    if (!parsed) {
      continue;
    }

    for (let hour = 0; hour < 24; hour++) {
      overallHours[hour] += parsed[hour];
    }
    overallCountDays += 1;

    if (!value?.end_time) {
      continue;
    }

    const endTime = new Date(value.end_time);
    if (Number.isNaN(endTime.getTime())) {
      continue;
    }

    const local = TimezoneService.toLocal(new Date(endTime.getTime() - 1000), timezone);
    const day = local.getDay();
    for (let hour = 0; hour < 24; hour++) {
      hm[day][hour] += parsed[hour];
      counts[day][hour] += 1;
    }
  }

  if (overallCountDays === 0) {
    return null;
  }

  for (let hour = 0; hour < 24; hour++) {
    overallHours[hour] = overallHours[hour] / overallCountDays;
  }

  for (let day = 0; day < 7; day++) {
    let hasAny = false;
    for (let hour = 0; hour < 24; hour++) {
      if (counts[day][hour] > 0) {
        hm[day][hour] = hm[day][hour] / counts[day][hour];
        hasAny = true;
      }
    }
    if (hasAny) {
      continue;
    }

    for (let hour = 0; hour < 24; hour++) {
      hm[day][hour] = overallHours[hour];
    }
  }

  return hm;
}

export async function computeFromInsights(
  brandId: string,
  timezone: string
): Promise<BestTimePayload | null> {
  const credentials = await PublisherCredentialsService.getCredentialsForBrand(brandId);
  if (!credentials?.accessToken || !credentials.accountId) {
    throw new Error('Missing Instagram credentials');
  }

  const url = `https://graph.facebook.com/${FB_GRAPH_API_VERSION}/${credentials.accountId}/insights`;
  const params = new URLSearchParams({
    metric: 'online_followers',
    period: 'lifetime',
    access_token: credentials.accessToken,
  });

  const response = await axios.get(`${url}?${params.toString()}`);
  type InsightValueItem = { end_time?: string; value: Record<string, number> | number[] };
  type InsightMetricEntry = { name: string; values?: InsightValueItem[] };

  const data: InsightMetricEntry[] | undefined = response.data?.data;
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  const entry = data.find((metric) => metric.name === 'online_followers') || data[0];
  const values = entry?.values as InsightValueItem[] | undefined;
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const heatmap = buildInsightsHeatmap(values, timezone);
  if (!heatmap) {
    return null;
  }

  const normalized = normalizeHeatmap(smoothHeatmapHoursOnly(heatmap));
  return {
    brandId,
    platform: 'instagram',
    timezone,
    source: 'instagram_insights',
    confidence: 0.85,
    generatedAt: new Date().toISOString(),
    ttlSeconds: DEFAULT_TTL,
    heatmap: normalized,
    topWindows: rankTopWindows(normalized, timezone),
    notes: [
      'Insights-based',
      'Averaged across last 30 days by weekday',
      'Smoothed (hours only)',
      defaultWindowNote(),
    ],
  };
}

function applyDaypartBackoff(hm: number[][]): void {
  const dayparts = [
    [6, 11],
    [12, 17],
    [18, 22],
  ];

  const hm2 = emptyHeatmap();
  for (let day = 0; day < 7; day++) {
    for (const [start, end] of dayparts) {
      let sum = 0;
      let count = 0;
      for (let hour = start; hour <= end; hour++) {
        sum += hm[day][hour];
        count++;
      }
      const average = count ? sum / count : 0;
      for (let hour = start; hour <= end; hour++) {
        hm2[day][hour] = average;
      }
    }
  }

  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      if (hm2[day][hour] !== 0) {
        hm[day][hour] = hm2[day][hour];
      }
    }
  }
}

export async function computeFromHistory(
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
  for (const row of rows) {
    if (!row.publishedAt) {
      continue;
    }

    const local = TimezoneService.toLocal(row.publishedAt, timezone);
    const day = local.getDay();
    const hour = local.getHours();

    const metrics = row.metricsLatest || { likes: 0, comments: 0, reach: 0 };
    const likes = Number(metrics.likes || 0);
    const comments = Number(metrics.comments || 0);
    const reach = Number(metrics.reach || 0);
    const score = (likes + 2 * comments) * (reach > 0 ? Math.sqrt(reach) : 1);

    hm[day][hour] += score;
    counts[day][hour] += 1;
  }

  let nonZeroBuckets = 0;
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      if (counts[day][hour] > 0) {
        hm[day][hour] = hm[day][hour] / counts[day][hour];
      }
      if (hm[day][hour] > 0) {
        nonZeroBuckets += 1;
      }
    }
  }

  if (nonZeroBuckets < 10) {
    applyDaypartBackoff(hm);
  }

  const normalized = normalizeHeatmap(smoothHeatmap(hm));
  return {
    brandId,
    platform: 'instagram',
    timezone,
    source: 'history',
    confidence: Math.min(0.85, 0.5 + rows.length / 1000),
    generatedAt: new Date().toISOString(),
    ttlSeconds: DEFAULT_TTL,
    heatmap: normalized,
    topWindows: rankTopWindows(normalized, timezone),
    notes: [
      'History-based',
      `Sample=${rows.length}`,
      'Weighted likes + comments (+reach)',
      defaultWindowNote(),
    ],
  };
}

export function computeHeuristic(brandId: string, timezone: string): BestTimePayload {
  const hm = emptyHeatmap();
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      let base = 0.3;
      if ((hour >= 10 && hour <= 12) || (hour >= 18 && hour <= 20)) {
        base = 1;
      } else if ((hour >= 8 && hour <= 9) || (hour >= 21 && hour <= 22)) {
        base = 0.6;
      }
      hm[day][hour] = base;
    }
  }

  const normalized = normalizeHeatmap(smoothHeatmap(hm));
  return {
    brandId,
    platform: 'instagram',
    timezone,
    source: 'heuristic',
    confidence: 0.5,
    generatedAt: new Date().toISOString(),
    ttlSeconds: DEFAULT_TTL,
    heatmap: normalized,
    topWindows: rankTopWindows(normalized, timezone),
    notes: ['Heuristic defaults', defaultWindowNote()],
  };
}
