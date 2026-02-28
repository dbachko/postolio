import { prisma } from '../../config/database.js';
import { isMultiDestinationEnabledForUser } from '../../utils/feature-flags.js';
import {
  RecipeConfigSchema,
  type RecipeConfig,
  type RecipeStep,
} from '../recipes/config-schema.js';
import { executeRuntimeStep, resolveStepInput } from './run-executor-runtime-step.js';
import {
  ensureRunSteps,
  isRunCanceled,
  markCurrentRunningStepFailed,
  updateRunStatus,
  updateRunStep,
} from './run-executor-persistence.js';
import { now, truncateText } from './run-executor-shared.js';
import type { ExecuteStepContext, RunState } from './run-executor-types.js';
import { redactSensitive } from './redaction.js';
import { evalWhen } from './when.js';

type LoadedRun = NonNullable<Awaited<ReturnType<typeof loadRunForExecution>>>;

async function loadRunForExecution(runId: string) {
  return prisma.recipeRun.findUnique({
    where: { id: runId },
    include: {
      createdByUser: { select: { email: true, id: true } },
      recipeTemplateVersion: {
        include: {
          recipeTemplate: {
            select: {
              id: true,
              brandId: true,
              isCurated: true,
              status: true,
              name: true,
              slug: true,
            },
          },
        },
      },
    },
  });
}

async function claimQueuedRun(runId: string): Promise<boolean> {
  const started = await prisma.recipeRun.updateMany({
    where: { id: runId, status: 'queued' },
    data: { status: 'running', startedAt: now() },
  });
  return started.count === 1;
}

async function readRunStatus(runId: string): Promise<string> {
  const run = await prisma.recipeRun.findUnique({
    where: { id: runId },
    select: { status: true },
  });
  return run?.status || 'unknown';
}

function buildRunState(run: LoadedRun): RunState {
  return {
    input: run.inputJson as any,
  };
}

function buildStepContext(
  run: LoadedRun,
  config: RecipeConfig,
  multiDestinationEnabled: boolean
): ExecuteStepContext {
  return {
    runId: run.id,
    runBrandId: run.brandId,
    runContentSeriesId: run.contentSeriesId || null,
    runInputJson:
      run.inputJson && typeof run.inputJson === 'object'
        ? (run.inputJson as Record<string, unknown>)
        : {},
    recipeTemplateId: run.recipeTemplateId,
    recipeTemplateVersionId: run.recipeTemplateVersionId,
    recipeTemplateName: run.recipeTemplateVersion.recipeTemplate.name,
    multiDestinationEnabled,
    config,
  };
}

async function markSkippedStep(runId: string, index: number, when: unknown): Promise<void> {
  const timestamp = now();
  await updateRunStep({
    runId,
    index,
    data: {
      status: 'skipped',
      startedAt: timestamp,
      finishedAt: timestamp,
      inputJsonRedacted: { when: when || null },
    },
  });
}

async function markStepRunning(
  runId: string,
  index: number,
  resolvedInput: unknown
): Promise<void> {
  await updateRunStep({
    runId,
    index,
    data: {
      status: 'running',
      startedAt: now(),
      inputJsonRedacted: redactSensitive(resolvedInput),
    },
  });
}

async function markStepSuccess(runId: string, index: number, output: unknown): Promise<void> {
  await updateRunStep({
    runId,
    index,
    data: {
      status: 'success',
      finishedAt: now(),
      outputJsonRedacted: redactSensitive(output),
    },
  });
}

async function executeConfiguredSteps(params: {
  run: LoadedRun;
  steps: RecipeStep[];
  config: RecipeConfig;
}): Promise<'success' | 'canceled'> {
  const state = buildRunState(params.run);
  const multiDestinationEnabled = isMultiDestinationEnabledForUser({
    userId: params.run.createdByUserId ?? null,
    email: params.run.createdByUser?.email ?? null,
  });
  const stepContext = buildStepContext(params.run, params.config, multiDestinationEnabled);

  for (let index = 0; index < params.steps.length; index++) {
    if (await isRunCanceled(params.run.id)) {
      await updateRunStatus(params.run.id, { finishedAt: now() });
      return 'canceled';
    }

    const step = params.steps[index] as RecipeStep;
    if (!evalWhen(step.when, state)) {
      await markSkippedStep(params.run.id, index, step.when);
      continue;
    }

    const resolvedInput = resolveStepInput(step, state);
    await markStepRunning(params.run.id, index, resolvedInput);
    const output = await executeRuntimeStep({
      ctx: stepContext,
      step,
      state,
      defaultOutputKey: `step_${index}_output`,
    });
    await markStepSuccess(params.run.id, index, output);
  }

  return 'success';
}

async function finalizeFailedRun(runId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : 'Unknown error';
  await updateRunStatus(runId, {
    status: 'failed',
    finishedAt: now(),
    errorCode: 'RECIPE_RUN_FAILED',
    errorMessage: 'Run failed. Please try again or edit the recipe.',
    internalError: truncateText(message, 4000),
  });

  try {
    await markCurrentRunningStepFailed(runId, message);
  } catch {
    return;
  }
}

export async function executeRecipeRun(runId: string): Promise<{ runId: string; status: string }> {
  const run = await loadRunForExecution(runId);
  if (!run) {
    return { runId, status: 'not_found' };
  }

  if (run.status !== 'queued') {
    return { runId, status: run.status };
  }

  const claimed = await claimQueuedRun(runId);
  if (!claimed) {
    return { runId, status: await readRunStatus(runId) };
  }

  const config = RecipeConfigSchema.parse(run.recipeTemplateVersion.configJson) as RecipeConfig;
  const steps = config.steps;
  await ensureRunSteps(runId, steps);

  try {
    const status = await executeConfiguredSteps({ run, steps, config });
    if (status === 'canceled') {
      return { runId, status };
    }

    await updateRunStatus(runId, { status: 'success', finishedAt: now() });
    return { runId, status: 'success' };
  } catch (error) {
    await finalizeFailedRun(runId, error);
    return { runId, status: 'failed' };
  }
}
