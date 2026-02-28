import { prisma } from '../../config/database.js';
import {
  RecipeConfigSchema,
  normalizeSkillRequirements,
  type RecipeConfig,
  type RecipeStep,
} from '../recipes/config-schema.js';
import { APIError } from '@postolio/errors';
import {
  estimateRecipeCredits,
  getAiCreditsSummary,
  getRunManagedCreditsSpent,
  topUpAiCredits,
  type RecipeCreditEstimate,
} from '../ai-credits.js';
import { buildGetRunResult } from './run-result-mappers.js';
import type { GetRunResult } from './runs-service-types.js';

export type CreateRunParams = {
  brandId: string;
  userId?: string | null;
  recipeVersionId: string;
  trigger: 'manual' | 'schedule' | 'api' | 'chat';
  input: unknown;
  contentSeriesId?: string | null;
};

type InstalledSkillRecord = {
  skillDefinitionId: string;
  enabled: boolean;
  mode: 'managed' | 'byok';
};

export type RunCostEstimate = {
  estimate: RecipeCreditEstimate;
  managedSkillIds: string[];
  balanceCredits: number;
  shortfallCredits: number;
  enforcementEnabled: boolean;
};

function collectSkillIdsFromSteps(steps: RecipeStep[], out: Set<string>) {
  for (const step of steps) {
    if (step.type === 'llm') {
      out.add('text_generation');
    }
    if (step.type === 'skill_call') {
      out.add(step.skill);
    }
    if (step.type === 'foreach') {
      collectSkillIdsFromSteps(step.do, out);
    }
  }
}

function inferManagedSkills(
  config: RecipeConfig,
  installsBySkill: Map<string, InstalledSkillRecord>
): string[] {
  const managed = new Set<string>();

  // Explicit prerequisites
  const requiredSkills = normalizeSkillRequirements(config?.skills_required)
    .filter((skill) => !skill.optional)
    .map((skill) => skill.id);
  for (const skillId of requiredSkills) {
    const install = installsBySkill.get(skillId);
    if (install?.enabled && install.mode === 'managed') {
      managed.add(skillId);
    }
  }

  // Runtime-implied capability usage (llm / skill_call) should also count
  const usedBySteps = new Set<string>();
  collectSkillIdsFromSteps(config.steps || [], usedBySteps);
  for (const skillId of usedBySteps) {
    const install = installsBySkill.get(skillId);
    if (install?.enabled && install.mode === 'managed') {
      managed.add(skillId);
    }
  }

  return Array.from(managed);
}

function assertRecipeTemplateAccess(
  template: { brandId: string | null; isCurated: boolean },
  runBrandId: string
) {
  // M8: recipes are catalog-managed only. Block legacy brand recipes.
  if (!template.isCurated || template.brandId !== null) {
    throw new APIError(
      'This recipe is no longer available. Choose a curated recipe from the catalog.',
      'RECIPE_NOT_SUPPORTED',
      400
    );
  }

  // Defensive check in case ownership rules evolve later.
  if (template.brandId && template.brandId !== runBrandId) {
    throw new APIError('Recipe does not belong to this brand', 'RECIPE_ACCESS_DENIED', 403);
  }
}

async function getRecipeVersionOrThrow(recipeVersionId: string) {
  const recipeVersion = await prisma.recipeTemplateVersion.findUnique({
    where: { id: recipeVersionId },
    include: {
      recipeTemplate: { select: { id: true, brandId: true, status: true, isCurated: true } },
    },
  });

  if (!recipeVersion) {
    throw new Error('Recipe version not found');
  }
  if (!recipeVersion.isPublished) {
    throw new Error('Recipe version is not published');
  }

  return recipeVersion;
}

async function loadInstalledSkills(
  brandId: string,
  skillIds: string[]
): Promise<Map<string, InstalledSkillRecord>> {
  if (skillIds.length === 0) {
    return new Map();
  }
  const installs = await prisma.skillInstallation.findMany({
    where: {
      brandId,
      skillDefinitionId: { in: skillIds },
    },
    select: { skillDefinitionId: true, enabled: true, mode: true },
  });
  return new Map(installs.map((row) => [row.skillDefinitionId, row] as const));
}

function validateRequiredSkills(params: {
  requiredSkillIds: string[];
  installsBySkill: Map<string, InstalledSkillRecord>;
}) {
  const missingSkills = params.requiredSkillIds
    .map((skillId: string) => {
      const rec = params.installsBySkill.get(skillId) || null;
      if (!rec) {
        return { skillId, reason: 'not_installed' as const };
      }
      if (!rec.enabled) {
        return { skillId, reason: 'disabled' as const };
      }
      return null;
    })
    .filter(Boolean) as Array<{ skillId: string; reason: 'not_installed' | 'disabled' }>;

  if (missingSkills.length) {
    throw new APIError('Missing required skills', 'MISSING_REQUIRED_SKILLS', 400, {
      missingSkills,
    });
  }
}

export async function estimateRunCost(params: {
  brandId: string;
  recipeVersionId: string;
  input?: unknown;
}): Promise<RunCostEstimate> {
  const recipeVersion = await getRecipeVersionOrThrow(params.recipeVersionId);
  assertRecipeTemplateAccess(recipeVersion.recipeTemplate, params.brandId);

  const config = RecipeConfigSchema.parse(recipeVersion.configJson) as RecipeConfig;
  const requiredSkillIds = normalizeSkillRequirements(config?.skills_required)
    .filter((skill) => !skill.optional)
    .map((skill) => skill.id);

  const skillsUsedBySteps = new Set<string>();
  collectSkillIdsFromSteps(config.steps || [], skillsUsedBySteps);
  const skillsToLoad = Array.from(new Set([...requiredSkillIds, ...skillsUsedBySteps]));
  const installsBySkill = await loadInstalledSkills(params.brandId, skillsToLoad);

  validateRequiredSkills({ requiredSkillIds, installsBySkill });

  const managedSkillIds = inferManagedSkills(config, installsBySkill);
  const estimate = estimateRecipeCredits({
    config,
    input: params.input,
    managedSkillIds: new Set(managedSkillIds),
  });
  const wallet = await getAiCreditsSummary(params.brandId);
  const shortfallCredits = Math.max(0, estimate.estimatedCredits - wallet.balanceCredits);

  return {
    estimate,
    managedSkillIds,
    balanceCredits: wallet.balanceCredits,
    shortfallCredits,
    enforcementEnabled: wallet.enforcementEnabled,
  };
}

export async function getRunCredits(brandId: string) {
  return await getAiCreditsSummary(brandId);
}

export async function grantRunCredits(params: {
  brandId: string;
  credits: number;
  note?: string | null;
}) {
  return await topUpAiCredits(params);
}

export async function createRun(params: CreateRunParams): Promise<{
  runId: string;
  status: 'queued' | 'running' | 'success' | 'failed' | 'canceled';
  costEstimate: {
    estimatedCredits: number;
    estimatedUsd: string;
    shortfallCredits: number;
    balanceCredits: number;
    enforcementEnabled: boolean;
  };
}> {
  const recipeVersion = await getRecipeVersionOrThrow(params.recipeVersionId);
  const template = recipeVersion.recipeTemplate;
  assertRecipeTemplateAccess(template, params.brandId);

  const runEstimate = await estimateRunCost({
    brandId: params.brandId,
    recipeVersionId: params.recipeVersionId,
    input: params.input,
  });
  if (runEstimate.enforcementEnabled && runEstimate.shortfallCredits > 0) {
    throw new APIError('Insufficient AI credits', 'INSUFFICIENT_AI_CREDITS', 402, {
      requiredCredits: runEstimate.estimate.estimatedCredits,
      balanceCredits: runEstimate.balanceCredits,
      shortfallCredits: runEstimate.shortfallCredits,
      estimatedUsd: runEstimate.estimate.estimatedUsd,
    });
  }

  const inputJson = params.input && typeof params.input === 'object' ? params.input : {};

  const run = await prisma.recipeRun.create({
    data: {
      brandId: params.brandId,
      recipeTemplateId: template.id,
      recipeTemplateVersionId: recipeVersion.id,
      ...(params.contentSeriesId ? { contentSeriesId: params.contentSeriesId } : {}),
      trigger: params.trigger,
      status: 'queued',
      inputJson,
      ...(params.userId ? { createdByUserId: params.userId } : {}),
    },
    select: { id: true, status: true },
  });

  return {
    runId: run.id,
    status: run.status,
    costEstimate: {
      estimatedCredits: runEstimate.estimate.estimatedCredits,
      estimatedUsd: runEstimate.estimate.estimatedUsd,
      shortfallCredits: runEstimate.shortfallCredits,
      balanceCredits: runEstimate.balanceCredits,
      enforcementEnabled: runEstimate.enforcementEnabled,
    },
  };
}

export async function listRuns(params: {
  brandId: string;
  status?: 'queued' | 'running' | 'success' | 'failed' | 'canceled';
  limit: number;
}) {
  const where: any = { brandId: params.brandId };
  if (params.status) {
    where.status = params.status;
  }

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

  if (!run) {
    return null;
  }

  const managedCreditsSpent = await getRunManagedCreditsSpent(runId);
  return buildGetRunResult(run, managedCreditsSpent);
}

export async function cancelRun(runId: string) {
  const canceled = await prisma.recipeRun.updateMany({
    where: {
      id: runId,
      status: { in: ['queued', 'running'] },
    },
    data: {
      status: 'canceled',
      finishedAt: new Date(),
    },
  });

  if (canceled.count > 0) {
    return { id: runId, status: 'canceled' as const };
  }

  const existing = await prisma.recipeRun.findUnique({
    where: { id: runId },
    select: { id: true, status: true },
  });
  if (!existing) {
    throw new APIError('Run not found', 'RUN_NOT_FOUND', 404, { runId });
  }

  return { id: existing.id, status: existing.status };
}

export async function markRunEnqueueFailed(params: {
  runId: string;
  internalError?: string | null;
}) {
  const internalError =
    typeof params.internalError === 'string' && params.internalError.trim().length > 0
      ? params.internalError.trim().slice(0, 4000)
      : null;

  await prisma.recipeRun.updateMany({
    where: { id: params.runId, status: 'queued' },
    data: {
      status: 'failed',
      finishedAt: new Date(),
      errorCode: 'RUN_ENQUEUE_FAILED',
      errorMessage: 'Run could not be started. Please retry.',
      internalError,
    },
  });
}
