import { prisma } from '../../config/database.js';
import type { RecipeStep } from '../recipes/config-schema.js';
import { truncateText } from './run-executor-shared.js';

function toPersistedStepType(
  step: RecipeStep
): 'llm' | 'skill_call' | 'transform' | 'content_create' | 'export' {
  if (step.type === 'foreach') {
    return 'transform';
  }
  return step.type;
}

export async function ensureRunSteps(runId: string, steps: RecipeStep[]): Promise<void> {
  await prisma.recipeRunStep.createMany({
    data: steps.map((step, index) => ({
      runId,
      index,
      type: toPersistedStepType(step),
      name: step.name,
      status: 'queued',
    })),
    skipDuplicates: true,
  });
}

export async function updateRunStatus(runId: string, data: Record<string, unknown>): Promise<void> {
  await prisma.recipeRun.update({
    where: { id: runId },
    data: data as any,
  });
}

export async function isRunCanceled(runId: string): Promise<boolean> {
  const run = await prisma.recipeRun.findUnique({
    where: { id: runId },
    select: { status: true },
  });
  return run?.status === 'canceled';
}

export async function updateRunStep(params: {
  runId: string;
  index: number;
  data: Record<string, unknown>;
}): Promise<void> {
  await prisma.recipeRunStep.update({
    where: { runId_index: { runId: params.runId, index: params.index } },
    data: params.data as any,
  });
}

export async function createRunArtifact(params: {
  runId: string;
  kind: 'markdown' | 'text' | 'json' | 'asset';
  name: string;
  mimeType?: string | null;
  contentText?: string | null;
  assetId?: string | null;
}): Promise<void> {
  const contentText = params.contentText ? truncateText(params.contentText, 64_000) : null;

  await prisma.recipeRunArtifact.create({
    data: {
      runId: params.runId,
      kind: params.kind,
      name: params.name,
      mimeType: params.mimeType || null,
      contentText,
      assetId: params.assetId || null,
      sizeBytes: contentText ? Buffer.byteLength(contentText, 'utf8') : null,
    },
  });
}

export async function markCurrentRunningStepFailed(runId: string, message: string): Promise<void> {
  const runningStep = await prisma.recipeRunStep.findFirst({
    where: { runId, status: 'running' },
    select: { index: true },
    orderBy: { index: 'desc' },
  });

  if (!runningStep) {
    return;
  }

  await updateRunStep({
    runId,
    index: runningStep.index,
    data: {
      status: 'failed',
      finishedAt: new Date(),
      errorMessage: truncateText(message, 2000),
    },
  });
}
