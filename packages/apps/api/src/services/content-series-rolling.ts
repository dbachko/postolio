import { prisma } from '../config/database.js';
import { buildSeriesRollingStatus } from './content-series-rolling/workflows.js';
import {
  getBrandSeriesPlaceholders,
  refreshSeriesRolling,
} from './content-series-rolling/refresh-workflows.js';

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
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
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

  return {
    source: 'recipe',
    recipeTemplateId: recipeTemplateIdRaw || null,
    recipeTemplateVersionId,
    inputJson: asRecord(raw.inputJson),
    createdFromRunId: createdFromRunIdRaw || null,
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

    return buildSeriesRollingStatus({
      series: {
        ...series,
        status: series.status as 'active' | 'paused' | 'archived',
      },
      normalizeSeriesRollingConfig,
      normalizeSeriesGeneratorSource,
    });
  }

  async refresh(contentSeriesId: string): Promise<SeriesRollingRefreshResult> {
    return refreshSeriesRolling({
      contentSeriesId,
      deps: {
        normalizeSeriesRollingConfig,
        normalizeSeriesGeneratorSource,
      },
      getStatus: (id) => this.getStatus(id),
    });
  }

  async getBrandPlaceholders(params: {
    brandId: string;
    monthStart: Date;
    monthEnd: Date;
  }): Promise<SeriesRollingPlaceholder[]> {
    return getBrandSeriesPlaceholders({
      brandId: params.brandId,
      monthStart: params.monthStart,
      monthEnd: params.monthEnd,
      deps: {
        normalizeSeriesRollingConfig,
        normalizeSeriesGeneratorSource,
      },
    });
  }
}

export const contentSeriesRollingService = new ContentSeriesRollingService();
