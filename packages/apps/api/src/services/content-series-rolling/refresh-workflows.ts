import { prisma } from '../../config/database.js';
import { acquireDistributedLock } from '../distributed-lock.js';
import { enqueueRecipeRun } from '../recipe-runs/queue.js';
import { createRun } from '../recipe-runs/runs-service.js';
import type {
  SeriesRollingPlaceholder,
  SeriesRollingRefreshResult,
  SeriesRollingStatus,
} from '../content-series-rolling.js';
import {
  type BuildStatusDependencies,
  type SeriesRecord,
  buildSeriesRollingStatus,
} from './workflows.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function loadSeries(contentSeriesId: string): Promise<SeriesRecord | null> {
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

  return {
    ...series,
    status: series.status as 'active' | 'paused' | 'archived',
  };
}

function notTriggeredResult(params: {
  seriesId: string;
  reason: SeriesRollingRefreshResult['reason'];
  status: SeriesRollingStatus | null;
}): SeriesRollingRefreshResult {
  return {
    contentSeriesId: params.seriesId,
    triggered: false,
    reason: params.reason,
    runId: null,
    postsRequested: 0,
    status: params.status,
  };
}

async function enqueueSeriesRun(params: {
  series: SeriesRecord;
  status: SeriesRollingStatus;
}): Promise<{ runId: string; postsRequested: number }> {
  const postsRequested = Math.max(
    1,
    Math.min(params.status.recommendedPostsToGenerate, params.status.rolling.batchSize)
  );

  const runInput = {
    ...params.status.generator?.inputJson,
    content_series_id: params.series.id,
    rolling_post_limit: postsRequested,
    ...(params.status.defaultTargetSocialAccountId
      ? { target_social_account_id: params.status.defaultTargetSocialAccountId }
      : {}),
  };

  const created = await createRun({
    brandId: params.series.brandId,
    userId: null,
    recipeVersionId: params.status.generator!.recipeTemplateVersionId,
    trigger: 'schedule',
    input: runInput,
    contentSeriesId: params.series.id,
  });

  await enqueueRecipeRun(created.runId);

  const updatedGenerator = {
    ...asRecord(params.series.generatorJson),
    source: 'recipe',
    recipeTemplateVersionId: params.status.generator!.recipeTemplateVersionId,
    recipeTemplateId: params.status.generator!.recipeTemplateId,
    inputJson: params.status.generator!.inputJson,
    lastEnqueuedRunId: created.runId,
    lastEnqueuedAt: new Date().toISOString(),
  };

  await prisma.contentSeries.update({
    where: { id: params.series.id },
    data: { generatorJson: updatedGenerator as any },
    select: { id: true },
  });

  return { runId: created.runId, postsRequested };
}

async function refreshWithLock(params: {
  series: SeriesRecord;
  deps: BuildStatusDependencies;
  getStatus: (contentSeriesId: string) => Promise<SeriesRollingStatus | null>;
}): Promise<SeriesRollingRefreshResult> {
  const status = await buildSeriesRollingStatus({
    series: params.series,
    ...params.deps,
  });

  if (!status.rolling.enabled) {
    return notTriggeredResult({ seriesId: params.series.id, reason: 'rolling_disabled', status });
  }
  if (params.series.status !== 'active') {
    return notTriggeredResult({ seriesId: params.series.id, reason: 'series_inactive', status });
  }
  if (!status.generator?.recipeTemplateVersionId) {
    return notTriggeredResult({
      seriesId: params.series.id,
      reason: 'generator_not_configured',
      status,
    });
  }
  if (status.activeScheduleRuns > 0) {
    return notTriggeredResult({ seriesId: params.series.id, reason: 'already_generating', status });
  }
  if (!status.needsGeneration || status.recommendedPostsToGenerate <= 0) {
    return notTriggeredResult({ seriesId: params.series.id, reason: 'queue_sufficient', status });
  }

  const created = await enqueueSeriesRun({ series: params.series, status });
  const refreshedStatus = await params.getStatus(params.series.id);

  return {
    contentSeriesId: params.series.id,
    triggered: true,
    reason: 'enqueued',
    runId: created.runId,
    postsRequested: created.postsRequested,
    status: refreshedStatus,
  };
}

export async function refreshSeriesRolling(params: {
  contentSeriesId: string;
  deps: BuildStatusDependencies;
  getStatus: (contentSeriesId: string) => Promise<SeriesRollingStatus | null>;
}): Promise<SeriesRollingRefreshResult> {
  const series = await loadSeries(params.contentSeriesId);
  if (!series) {
    return notTriggeredResult({
      seriesId: params.contentSeriesId,
      reason: 'not_found',
      status: null,
    });
  }

  const lock = await acquireDistributedLock({
    key: `content-series:rolling-refresh:${series.id}`,
    ttlSeconds: 90,
  });
  if (!lock.acquired) {
    const status = await buildSeriesRollingStatus({ series, ...params.deps });
    return notTriggeredResult({ seriesId: series.id, reason: 'already_generating', status });
  }

  try {
    return await refreshWithLock({
      series,
      deps: params.deps,
      getStatus: params.getStatus,
    });
  } finally {
    await lock.release();
  }
}

export async function getBrandSeriesPlaceholders(params: {
  brandId: string;
  monthStart: Date;
  monthEnd: Date;
  deps: BuildStatusDependencies;
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
  for (const rawSeries of seriesList) {
    const series: SeriesRecord = {
      ...rawSeries,
      status: rawSeries.status as 'active' | 'paused' | 'archived',
    };

    const status = await buildSeriesRollingStatus({ series, ...params.deps });
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
