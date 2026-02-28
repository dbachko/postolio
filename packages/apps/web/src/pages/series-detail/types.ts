export type RollingConfig = {
  enabled: boolean;
  minQueueDays: number;
  targetQueueDays: number;
  maxQueueDays: number;
  batchSize: number;
};

export type RollingStatus = {
  contentSeriesId: string;
  timezone: string;
  daysAhead: number;
  furthestDayOffset: number;
  futurePostCount: number;
  activeScheduleRuns: number;
  needsGeneration: boolean;
  recommendedPostsToGenerate: number;
  nextGenerationAt: string | null;
  missingDates: string[];
  rolling: RollingConfig;
  generator: {
    source: 'recipe';
    recipeTemplateId: string | null;
    recipeTemplateVersionId: string;
  } | null;
};

export type ContentSeries = {
  id: string;
  brandId: string;
  key: string | null;
  name: string;
  description: string | null;
  color: string | null;
  kind: 'batch' | 'rolling';
  status: 'active' | 'paused' | 'archived';
  rollingConfigJson?: unknown;
  createdAt: string;
  updatedAt: string;
};

export type GenerationSummary = {
  id: string;
  status: string;
  trigger: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  recipe: {
    id: string;
    slug: string;
    name: string;
    category: string;
    version: number | null;
  } | null;
};

export type SeriesContentItem = {
  id: string;
  caption: string;
  status: string;
  scheduledAt: string | null;
  postedAt: string | null;
  recipeRunId: string | null;
  generatedByRecipe: { id: string; slug: string; name: string } | null;
};
