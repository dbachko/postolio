import { prisma } from '../../config/database.js';
import { RecipeConfigSchema } from '../recipes/config-schema.js';

export type CreateRunParams = {
  brandId: string;
  userId: string;
  recipeVersionId: string;
  trigger: 'manual' | 'schedule' | 'api' | 'chat';
  input: unknown;
};

export async function createRun(params: CreateRunParams): Promise<{
  runId: string;
  status: 'queued' | 'running' | 'success' | 'failed' | 'canceled';
}> {
  const recipeVersion = await prisma.recipeTemplateVersion.findUnique({
    where: { id: params.recipeVersionId },
    include: {
      recipeTemplate: { select: { id: true, brandId: true, status: true, isCurated: true } },
    },
  });

  if (!recipeVersion) {
    throw new Error('Recipe version not found');
  }

  const template = recipeVersion.recipeTemplate;

  // Curated recipes can be run by any brand; user recipes must match the brand.
  if (template.brandId && template.brandId !== params.brandId) {
    throw new Error('Recipe does not belong to this brand');
  }

  if (!recipeVersion.isPublished) {
    throw new Error('Recipe version is not published');
  }

  // Validate config early (runner also validates). This avoids enqueuing broken recipes.
  RecipeConfigSchema.parse(recipeVersion.configJson);

  const inputJson = params.input && typeof params.input === 'object' ? params.input : {};

  const run = await prisma.recipeRun.create({
    data: {
      brandId: params.brandId,
      recipeTemplateId: template.id,
      recipeTemplateVersionId: recipeVersion.id,
      trigger: params.trigger,
      status: 'queued',
      inputJson,
      createdByUserId: params.userId,
    },
    select: { id: true, status: true },
  });

  return { runId: run.id, status: run.status };
}

export async function listRuns(params: {
  brandId: string;
  status?: 'queued' | 'running' | 'success' | 'failed' | 'canceled';
  limit: number;
}) {
  const where: any = { brandId: params.brandId };
  if (params.status) where.status = params.status;

  const runs = await prisma.recipeRun.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: params.limit,
    include: {
      recipeTemplate: { select: { id: true, name: true, slug: true, isCurated: true } },
    },
  });

  return runs.map((r) => ({
    id: r.id,
    status: r.status,
    trigger: r.trigger,
    createdAt: r.createdAt.toISOString(),
    startedAt: r.startedAt ? r.startedAt.toISOString() : null,
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    recipe: r.recipeTemplate,
  }));
}

export type GetRunResult = {
  run: {
    id: string;
    brandId: string;
    status: 'queued' | 'running' | 'success' | 'failed' | 'canceled';
    trigger: 'manual' | 'schedule' | 'api' | 'chat';
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    input: unknown;
    errorCode: string | null;
    errorMessage: string | null;
  };
  recipe: { id: string; name: string; slug: string; isCurated: boolean };
  recipeVersion: { id: string; version: number };
  steps: Array<{
    id: string;
    runId: string;
    index: number;
    type: string;
    name: string;
    status: string;
    startedAt: string | null;
    finishedAt: string | null;
    inputJsonRedacted: unknown;
    outputJsonRedacted: unknown;
    errorMessage: string | null;
    createdAt: string;
  }>;
  artifacts: Array<{
    id: string;
    runId: string;
    kind: 'markdown' | 'text' | 'json' | 'asset';
    name: string;
    mimeType: string | null;
    contentText: string | null;
    assetId: string | null;
    sizeBytes: number | null;
    createdAt: string;
  }>;
  costs: Array<{
    id: string;
    runId: string;
    provider: string;
    mode: 'managed' | 'byok';
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: string | null;
    notes: string | null;
    createdAt: string;
  }>;
};

export async function getRun(runId: string): Promise<GetRunResult | null> {
  const run = await prisma.recipeRun.findUnique({
    where: { id: runId },
    include: {
      recipeTemplate: { select: { id: true, name: true, slug: true, isCurated: true } },
      recipeTemplateVersion: { select: { id: true, version: true } },
      steps: { orderBy: { index: 'asc' } },
      artifacts: { orderBy: { createdAt: 'asc' } },
      costs: { orderBy: { createdAt: 'asc' } },
    },
  });

  if (!run) return null;

  return {
    run: {
      id: run.id,
      brandId: run.brandId,
      status: run.status,
      trigger: run.trigger,
      createdAt: run.createdAt.toISOString(),
      startedAt: run.startedAt ? run.startedAt.toISOString() : null,
      finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
      input: run.inputJson,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
    },
    recipe: run.recipeTemplate,
    recipeVersion: run.recipeTemplateVersion,
    steps: run.steps.map((s) => ({
      id: s.id,
      runId: s.runId,
      index: s.index,
      type: s.type,
      name: s.name,
      status: s.status,
      startedAt: s.startedAt ? s.startedAt.toISOString() : null,
      finishedAt: s.finishedAt ? s.finishedAt.toISOString() : null,
      inputJsonRedacted: s.inputJsonRedacted,
      outputJsonRedacted: s.outputJsonRedacted,
      errorMessage: s.errorMessage,
      createdAt: s.createdAt.toISOString(),
    })),
    artifacts: run.artifacts.map((a) => ({
      id: a.id,
      runId: a.runId,
      kind: a.kind,
      name: a.name,
      mimeType: a.mimeType,
      contentText: a.contentText,
      assetId: a.assetId,
      sizeBytes: a.sizeBytes,
      createdAt: a.createdAt.toISOString(),
    })),
    costs: run.costs.map((c) => ({
      id: c.id,
      runId: c.runId,
      provider: c.provider,
      mode: c.mode,
      inputTokens: c.inputTokens,
      outputTokens: c.outputTokens,
      estimatedCostUsd: c.estimatedCostUsd ? c.estimatedCostUsd.toString() : null,
      notes: c.notes,
      createdAt: c.createdAt.toISOString(),
    })),
  };
}

export async function cancelRun(runId: string) {
  return await prisma.recipeRun.update({
    where: { id: runId },
    data: {
      status: 'canceled',
      finishedAt: new Date(),
    },
    select: { id: true, status: true },
  });
}
