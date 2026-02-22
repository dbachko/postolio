import { formatInTimeZone } from 'date-fns-tz';

import { prisma } from '../config/database.js';
import { enqueueRecipeRun } from './recipe-runs/queue.js';
import { createRun } from './recipe-runs/runs-service.js';
import { acquireDistributedLock } from './distributed-lock.js';
import { TimezoneService } from './timezone.js';

export type SeriesRollingConfig = {
  enabled: boolean;
  minQueueDays: number;
  targetQueueDays: number;
  maxQueueDays: number;
  batchSize: number;
};

export type SeriesGeneratorSource = {
  source: 'recipe';
  recipeTemplateId: string | null;
  recipeTemplateVersionId: string;
  inputJson: Record<string, unknown>;
  createdFromRunId: string | null;
};

export type SeriesRollingPlaceholder = {
  id: string;
  scheduledAt: string;
  message: string;
  contentSeriesId: string;
  contentSeriesName: string;
  contentSeriesColor: string | null;
  targetSocialAccountId: string | null;
};

export type SeriesRollingStatus = {
  contentSeriesId: string;
  brandId: string;
  timezone: string;
  seriesStatus: 'active' | 'paused' | 'archived';
  rolling: SeriesRollingConfig;
  generator: SeriesGeneratorSource | null;
  postingTime: string;
  defaultTargetSocialAccountId: string | null;
  daysAhead: number;
  furthestDayOffset: number;
  futurePostCount: number;
  activeScheduleRuns: number;
  needsGeneration: boolean;
  recommendedPostsToGenerate: number;
  nextGenerationAt: string | null;
  missingDates: string[];
  placeholders: SeriesRollingPlaceholder[];
};

export type SeriesRollingRefreshResult = {
  contentSeriesId: string;
  triggered: boolean;
  reason:
    | 'not_found'
    | 'rolling_disabled'
    | 'series_inactive'
    | 'generator_not_configured'
    | 'already_generating'
    | 'queue_sufficient'
    | 'enqueued';
  runId: string | null;
  postsRequested: number;
  status: SeriesRollingStatus | null;
};

const DEFAULT_ROLLING_CONFIG: SeriesRollingConfig = {
  enabled: false,
  minQueueDays: 3,
  targetQueueDays: 7,
  maxQueueDays: 14,
  batchSize: 3,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, n));
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
  if (/^\d{2}:\d{2}$/.test(raw)) {
    return raw;
  }
  return '09:00';
}

export function normalizeSeriesRollingConfig(input: unknown): SeriesRollingConfig {
  const raw = asRecord(input);
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_ROLLING_CONFIG.enabled;
  const minQueueDays = toInt(raw.minQueueDays, DEFAULT_ROLLING_CONFIG.minQueueDays, 1, 365);
  const targetQueueDays = toInt(
    raw.targetQueueDays,
    Math.max(DEFAULT_ROLLING_CONFIG.targetQueueDays, minQueueDays),
    minQueueDays,
    365
  );
  const maxQueueDays = toInt(
    raw.maxQueueDays,
    Math.max(DEFAULT_ROLLING_CONFIG.maxQueueDays, targetQueueDays),
    targetQueueDays,
    365
  );
  const batchSize = toInt(raw.batchSize, DEFAULT_ROLLING_CONFIG.batchSize, 1, maxQueueDays);

  return {
    enabled,
    minQueueDays,
    targetQueueDays,
    maxQueueDays,
    batchSize,
  };
}

export function normalizeSeriesGeneratorSource(input: unknown): SeriesGeneratorSource | null {
  const raw = asRecord(input);
  const source = typeof raw.source === 'string' ? raw.source.trim().toLowerCase() : '';
  if (!source) {
    return null;
  }

  const recipeTemplateVersionId =
    typeof raw.recipeTemplateVersionId === 'string' ? raw.recipeTemplateVersionId.trim() : '';
  if (!recipeTemplateVersionId) {
    return null;
  }

  const recipeTemplateIdRaw =
    typeof raw.recipeTemplateId === 'string' ? raw.recipeTemplateId.trim() : null;
  const createdFromRunIdRaw =
    typeof raw.createdFromRunId === 'string' ? raw.createdFromRunId.trim() : null;
  const inputJson = asRecord(raw.inputJson);

  return {
    source: 'recipe',
    recipeTemplateId: recipeTemplateIdRaw || null,
    recipeTemplateVersionId,
    inputJson,
    createdFromRunId: createdFromRunIdRaw || null,
  };
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
    const fromInput =
      typeof input.target_social_account_id === 'string'
        ? input.target_social_account_id.trim()
        : typeof input.targetSocialAccountId === 'string'
          ? input.targetSocialAccountId.trim()
          : '';
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

async function buildSeriesRollingStatus(params: {
  series: {
    id: string;
    brandId: string;
    name: string;
    color: string | null;
    status: 'active' | 'paused' | 'archived';
    rollingConfigJson: unknown;
    generatorJson: unknown;
  };
  now?: Date;
}): Promise<SeriesRollingStatus> {
  const now = params.now ?? new Date();
  const series = params.series;
  const rolling = normalizeSeriesRollingConfig(series.rollingConfigJson);
  const generator = normalizeSeriesGeneratorSource(series.generatorJson);
  const timezone = await TimezoneService.getBrandTimezone(series.brandId);
  const postingTime = derivePostingTime(generator);
  const todayYmd = formatInTimeZone(now, timezone, 'yyyy-MM-dd');

  const rows =
    typeof (prisma as any).content?.findMany === 'function'
      ? await prisma.content.findMany({
          where: {
            contentSeriesId: series.id,
            scheduledAt: { not: null },
            status: { in: ['draft', 'scheduled'] },
          },
          select: {
            scheduledAt: true,
            targetSocialAccountId: true,
          },
          orderBy: { scheduledAt: 'asc' },
        })
      : [];

  const scheduledDays = new Set<string>();
  let furthestDayOffset = 0;
  let futurePostCount = 0;

  for (const row of rows) {
    if (!row.scheduledAt) {
      continue;
    }
    const ymd = formatInTimeZone(row.scheduledAt, timezone, 'yyyy-MM-dd');
    const offset = ymdDiff(todayYmd, ymd);
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
  for (let day = 1; day <= rolling.maxQueueDays; day++) {
    const ymd = addDaysToYmd(todayYmd, day);
    if (!scheduledDays.has(ymd)) {
      break;
    }
    daysAhead = day;
  }

  const missingDates: string[] = [];
  for (let day = 1; day <= rolling.targetQueueDays; day++) {
    const ymd = addDaysToYmd(todayYmd, day);
    if (!scheduledDays.has(ymd)) {
      missingDates.push(ymd);
    }
  }

  const activeScheduleRuns =
    typeof (prisma as any).recipeRun?.count === 'function'
      ? await prisma.recipeRun.count({
          where: {
            contentSeriesId: series.id,
            trigger: 'schedule',
            status: { in: ['queued', 'running'] },
          },
        })
      : 0;

  const needsGeneration =
    rolling.enabled &&
    series.status === 'active' &&
    Boolean(generator) &&
    daysAhead < rolling.targetQueueDays;

  const recommendedPostsToGenerate = Math.max(
    0,
    Math.min(rolling.maxQueueDays, rolling.targetQueueDays) - daysAhead
  );

  const nextGenerationAt = (() => {
    if (!rolling.enabled || series.status !== 'active') {
      return null;
    }
    if (needsGeneration) {
      return now.toISOString();
    }

    if (furthestDayOffset <= 0) {
      return null;
    }
    const nextOffset = Math.max(furthestDayOffset - rolling.minQueueDays + 1, 1);
    const triggerYmd = addDaysToYmd(todayYmd, nextOffset);
    try {
      return TimezoneService.createDateInBrandTimezone(
        triggerYmd,
        postingTime,
        timezone
      ).toISOString();
    } catch {
      return null;
    }
  })();

  const defaultTargetSocialAccountId = deriveTargetSocialAccountId(generator, rows);

  const placeholders: SeriesRollingPlaceholder[] =
    rolling.enabled && series.status === 'active'
      ? missingDates.map((ymd) => {
          const scheduledAt = TimezoneService.createDateInBrandTimezone(
            ymd,
            postingTime,
            timezone
          ).toISOString();
          return {
            id: `series-placeholder:${series.id}:${ymd}`,
            scheduledAt,
            message: `${series.name} rolling slot`,
            contentSeriesId: series.id,
            contentSeriesName: series.name,
            contentSeriesColor: series.color,
            targetSocialAccountId: defaultTargetSocialAccountId,
          };
        })
      : [];

  return {
    contentSeriesId: series.id,
    brandId: series.brandId,
    timezone,
    seriesStatus: series.status,
    rolling,
    generator,
    postingTime,
    defaultTargetSocialAccountId,
    daysAhead,
    furthestDayOffset,
    futurePostCount,
    activeScheduleRuns,
    needsGeneration,
    recommendedPostsToGenerate,
    nextGenerationAt,
    missingDates,
    placeholders,
  };
}

class ContentSeriesRollingService {
  async getStatus(contentSeriesId: string): Promise<SeriesRollingStatus | null> {
    const series = await prisma.contentSeries.findUnique({
      where: { id: contentSeriesId },
      select: {
        id: true,
        brandId: true,
        name: true,
        color: true,
        status: true,
        rollingConfigJson: true,
        generatorJson: true,
      },
    });

    if (!series) {
      return null;
    }
    return await buildSeriesRollingStatus({
      series: {
        ...series,
        status: series.status as 'active' | 'paused' | 'archived',
      },
    });
  }

  async refresh(contentSeriesId: string): Promise<SeriesRollingRefreshResult> {
    const series = await prisma.contentSeries.findUnique({
      where: { id: contentSeriesId },
      select: {
        id: true,
        brandId: true,
        name: true,
        color: true,
        status: true,
        rollingConfigJson: true,
        generatorJson: true,
      },
    });

    if (!series) {
      return {
        contentSeriesId,
        triggered: false,
        reason: 'not_found',
        runId: null,
        postsRequested: 0,
        status: null,
      };
    }

    const lock = await acquireDistributedLock({
      key: `content-series:rolling-refresh:${series.id}`,
      ttlSeconds: 90,
    });
    if (!lock.acquired) {
      const status = await buildSeriesRollingStatus({
        series: {
          ...series,
          status: series.status as 'active' | 'paused' | 'archived',
        },
      });
      return {
        contentSeriesId: series.id,
        triggered: false,
        reason: 'already_generating',
        runId: null,
        postsRequested: 0,
        status,
      };
    }

    try {
      const status = await buildSeriesRollingStatus({
        series: {
          ...series,
          status: series.status as 'active' | 'paused' | 'archived',
        },
      });

      if (!status.rolling.enabled) {
        return {
          contentSeriesId: series.id,
          triggered: false,
          reason: 'rolling_disabled',
          runId: null,
          postsRequested: 0,
          status,
        };
      }

      if (series.status !== 'active') {
        return {
          contentSeriesId: series.id,
          triggered: false,
          reason: 'series_inactive',
          runId: null,
          postsRequested: 0,
          status,
        };
      }

      if (!status.generator?.recipeTemplateVersionId) {
        return {
          contentSeriesId: series.id,
          triggered: false,
          reason: 'generator_not_configured',
          runId: null,
          postsRequested: 0,
          status,
        };
      }

      if (status.activeScheduleRuns > 0) {
        return {
          contentSeriesId: series.id,
          triggered: false,
          reason: 'already_generating',
          runId: null,
          postsRequested: 0,
          status,
        };
      }

      if (!status.needsGeneration || status.recommendedPostsToGenerate <= 0) {
        return {
          contentSeriesId: series.id,
          triggered: false,
          reason: 'queue_sufficient',
          runId: null,
          postsRequested: 0,
          status,
        };
      }

      const postsRequested = Math.max(
        1,
        Math.min(status.recommendedPostsToGenerate, status.rolling.batchSize)
      );

      const runInput = {
        ...status.generator.inputJson,
        content_series_id: series.id,
        rolling_post_limit: postsRequested,
        ...(status.defaultTargetSocialAccountId
          ? { target_social_account_id: status.defaultTargetSocialAccountId }
          : {}),
      };

      const created = await createRun({
        brandId: series.brandId,
        userId: null,
        recipeVersionId: status.generator.recipeTemplateVersionId,
        trigger: 'schedule',
        input: runInput,
        contentSeriesId: series.id,
      });

      await enqueueRecipeRun(created.runId);

      const updatedGenerator = {
        ...asRecord(series.generatorJson),
        source: 'recipe',
        recipeTemplateVersionId: status.generator.recipeTemplateVersionId,
        recipeTemplateId: status.generator.recipeTemplateId,
        inputJson: status.generator.inputJson,
        lastEnqueuedRunId: created.runId,
        lastEnqueuedAt: new Date().toISOString(),
      };

      await prisma.contentSeries.update({
        where: { id: series.id },
        data: { generatorJson: updatedGenerator as any },
        select: { id: true },
      });

      const refreshedStatus = await this.getStatus(series.id);

      return {
        contentSeriesId: series.id,
        triggered: true,
        reason: 'enqueued',
        runId: created.runId,
        postsRequested,
        status: refreshedStatus,
      };
    } finally {
      await lock.release();
    }
  }

  async getBrandPlaceholders(params: {
    brandId: string;
    monthStart: Date;
    monthEnd: Date;
  }): Promise<SeriesRollingPlaceholder[]> {
    const seriesList =
      typeof (prisma as any).contentSeries?.findMany === 'function'
        ? await prisma.contentSeries.findMany({
            where: {
              brandId: params.brandId,
              status: { in: ['active', 'paused'] },
            },
            select: {
              id: true,
              brandId: true,
              name: true,
              color: true,
              status: true,
              rollingConfigJson: true,
              generatorJson: true,
            },
            orderBy: { updatedAt: 'desc' },
            take: 100,
          })
        : [];

    const placeholders: SeriesRollingPlaceholder[] = [];

    for (const series of seriesList) {
      const status = await buildSeriesRollingStatus({
        series: {
          ...series,
          status: series.status as 'active' | 'paused' | 'archived',
        },
      });
      if (!status.rolling.enabled || status.seriesStatus !== 'active') {
        continue;
      }

      for (const placeholder of status.placeholders) {
        const date = new Date(placeholder.scheduledAt);
        if (Number.isNaN(date.getTime())) {
          continue;
        }
        if (date < params.monthStart || date > params.monthEnd) {
          continue;
        }
        placeholders.push(placeholder);
      }
    }

    return placeholders;
  }
}

export const contentSeriesRollingService = new ContentSeriesRollingService();
