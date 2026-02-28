import { formatInTimeZone } from 'date-fns-tz';
import { prisma } from '../../config/database.js';
import { TimezoneService } from '../timezone.js';
import type {
  SeriesGeneratorSource,
  SeriesRollingConfig,
  SeriesRollingPlaceholder,
  SeriesRollingStatus,
} from '../content-series-rolling.js';

export type SeriesRecord = {
  id: string;
  brandId: string;
  name: string;
  color: string | null;
  status: 'active' | 'paused' | 'archived';
  rollingConfigJson: unknown;
  generatorJson: unknown;
};

export type BuildStatusDependencies = {
  normalizeSeriesRollingConfig: (input: unknown) => SeriesRollingConfig;
  normalizeSeriesGeneratorSource: (input: unknown) => SeriesGeneratorSource | null;
};

type BuildStatusParams = {
  series: SeriesRecord;
  now?: Date;
} & BuildStatusDependencies;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map((n) => Number.parseInt(n, 10));
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function ymdDiff(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split('-').map((n) => Number.parseInt(n, 10));
  const [ty, tm, td] = toYmd.split('-').map((n) => Number.parseInt(n, 10));
  const fromUtc = Date.UTC(fy, (fm || 1) - 1, fd || 1);
  const toUtc = Date.UTC(ty, (tm || 1) - 1, td || 1);
  return Math.floor((toUtc - fromUtc) / (24 * 60 * 60 * 1000));
}

function sanitizePostingTime(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  return /^\d{2}:\d{2}$/.test(raw) ? raw : '09:00';
}

function readString(input: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return '';
}

function derivePostingTime(generator: SeriesGeneratorSource | null): string {
  if (!generator) {
    return '09:00';
  }
  const input = asRecord(generator.inputJson);
  return sanitizePostingTime(input.posting_time ?? input.postingTime);
}

function deriveTargetSocialAccountId(
  generator: SeriesGeneratorSource | null,
  fromContentRows: Array<{ targetSocialAccountId: string | null }>
): string | null {
  if (generator) {
    const input = asRecord(generator.inputJson);
    const fromInput = readString(input, ['target_social_account_id', 'targetSocialAccountId']);
    if (fromInput.length > 0) {
      return fromInput;
    }
  }

  const fromContent = fromContentRows
    .map((row) =>
      typeof row.targetSocialAccountId === 'string' ? row.targetSocialAccountId.trim() : ''
    )
    .find((id) => id.length > 0);
  return fromContent || null;
}

async function loadScheduledRows(seriesId: string) {
  if (typeof (prisma as any).content?.findMany !== 'function') {
    return [] as Array<{ scheduledAt: Date | null; targetSocialAccountId: string | null }>;
  }

  return prisma.content.findMany({
    where: {
      contentSeriesId: seriesId,
      scheduledAt: { not: null },
      status: { in: ['draft', 'scheduled'] },
    },
    select: {
      scheduledAt: true,
      targetSocialAccountId: true,
    },
    orderBy: { scheduledAt: 'asc' },
  });
}

function calculateCoverage(params: {
  rows: Array<{ scheduledAt: Date | null }>;
  timezone: string;
  todayYmd: string;
  rolling: SeriesRollingConfig;
}) {
  const scheduledDays = new Set<string>();
  let furthestDayOffset = 0;
  let futurePostCount = 0;

  for (const row of params.rows) {
    if (!row.scheduledAt) {
      continue;
    }
    const ymd = formatInTimeZone(row.scheduledAt, params.timezone, 'yyyy-MM-dd');
    const offset = ymdDiff(params.todayYmd, ymd);
    if (offset < 1) {
      continue;
    }
    futurePostCount += 1;
    scheduledDays.add(ymd);
    if (offset > furthestDayOffset) {
      furthestDayOffset = offset;
    }
  }

  let daysAhead = 0;
  for (let day = 1; day <= params.rolling.maxQueueDays; day++) {
    const ymd = addDaysToYmd(params.todayYmd, day);
    if (!scheduledDays.has(ymd)) {
      break;
    }
    daysAhead = day;
  }

  return { scheduledDays, furthestDayOffset, futurePostCount, daysAhead };
}

function buildMissingDates(
  todayYmd: string,
  rolling: SeriesRollingConfig,
  scheduledDays: Set<string>
) {
  const missingDates: string[] = [];
  for (let day = 1; day <= rolling.targetQueueDays; day++) {
    const ymd = addDaysToYmd(todayYmd, day);
    if (!scheduledDays.has(ymd)) {
      missingDates.push(ymd);
    }
  }
  return missingDates;
}

async function countActiveScheduleRuns(seriesId: string): Promise<number> {
  if (typeof (prisma as any).recipeRun?.count !== 'function') {
    return 0;
  }

  return prisma.recipeRun.count({
    where: {
      contentSeriesId: seriesId,
      trigger: 'schedule',
      status: { in: ['queued', 'running'] },
    },
  });
}

function computeNextGenerationAt(params: {
  rolling: SeriesRollingConfig;
  seriesStatus: SeriesRecord['status'];
  needsGeneration: boolean;
  now: Date;
  furthestDayOffset: number;
  minQueueDays: number;
  todayYmd: string;
  postingTime: string;
  timezone: string;
}): string | null {
  if (!params.rolling.enabled || params.seriesStatus !== 'active') {
    return null;
  }
  if (params.needsGeneration) {
    return params.now.toISOString();
  }
  if (params.furthestDayOffset <= 0) {
    return null;
  }

  const nextOffset = Math.max(params.furthestDayOffset - params.minQueueDays + 1, 1);
  const triggerYmd = addDaysToYmd(params.todayYmd, nextOffset);
  try {
    return TimezoneService.createDateInBrandTimezone(
      triggerYmd,
      params.postingTime,
      params.timezone
    ).toISOString();
  } catch {
    return null;
  }
}

function buildPlaceholders(params: {
  rolling: SeriesRollingConfig;
  series: SeriesRecord;
  missingDates: string[];
  postingTime: string;
  timezone: string;
  targetSocialAccountId: string | null;
}): SeriesRollingPlaceholder[] {
  if (!params.rolling.enabled || params.series.status !== 'active') {
    return [];
  }

  return params.missingDates.map((ymd) => {
    const scheduledAt = TimezoneService.createDateInBrandTimezone(
      ymd,
      params.postingTime,
      params.timezone
    ).toISOString();
    return {
      id: `series-placeholder:${params.series.id}:${ymd}`,
      scheduledAt,
      message: `${params.series.name} rolling slot`,
      contentSeriesId: params.series.id,
      contentSeriesName: params.series.name,
      contentSeriesColor: params.series.color,
      targetSocialAccountId: params.targetSocialAccountId,
    };
  });
}

export async function buildSeriesRollingStatus(
  params: BuildStatusParams
): Promise<SeriesRollingStatus> {
  const now = params.now ?? new Date();
  const rolling = params.normalizeSeriesRollingConfig(params.series.rollingConfigJson);
  const generator = params.normalizeSeriesGeneratorSource(params.series.generatorJson);
  const timezone = await TimezoneService.getBrandTimezone(params.series.brandId);
  const postingTime = derivePostingTime(generator);
  const todayYmd = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
  const rows = await loadScheduledRows(params.series.id);

  const coverage = calculateCoverage({ rows, timezone, todayYmd, rolling });
  const missingDates = buildMissingDates(todayYmd, rolling, coverage.scheduledDays);
  const activeScheduleRuns = await countActiveScheduleRuns(params.series.id);
  const needsGeneration =
    rolling.enabled &&
    params.series.status === 'active' &&
    Boolean(generator) &&
    coverage.daysAhead < rolling.targetQueueDays;
  const recommendedPostsToGenerate = Math.max(
    0,
    Math.min(rolling.maxQueueDays, rolling.targetQueueDays) - coverage.daysAhead
  );
  const nextGenerationAt = computeNextGenerationAt({
    rolling,
    seriesStatus: params.series.status,
    needsGeneration,
    now,
    furthestDayOffset: coverage.furthestDayOffset,
    minQueueDays: rolling.minQueueDays,
    todayYmd,
    postingTime,
    timezone,
  });
  const defaultTargetSocialAccountId = deriveTargetSocialAccountId(generator, rows);
  const placeholders = buildPlaceholders({
    rolling,
    series: params.series,
    missingDates,
    postingTime,
    timezone,
    targetSocialAccountId: defaultTargetSocialAccountId,
  });

  return {
    contentSeriesId: params.series.id,
    brandId: params.series.brandId,
    timezone,
    seriesStatus: params.series.status,
    rolling,
    generator,
    postingTime,
    defaultTargetSocialAccountId,
    daysAhead: coverage.daysAhead,
    furthestDayOffset: coverage.furthestDayOffset,
    futurePostCount: coverage.futurePostCount,
    activeScheduleRuns,
    needsGeneration,
    recommendedPostsToGenerate,
    nextGenerationAt,
    missingDates,
    placeholders,
  };
}
