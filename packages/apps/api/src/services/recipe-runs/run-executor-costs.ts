import { Prisma } from '@postolio/database';
import { prisma } from '../../config/database.js';
import {
  estimateOpenAiTextCostUsd,
  getEstimatedCreditsForSkillCall,
  getEstimatedUsdForSkillCall,
  recordManagedUsageDebit,
  usdToCredits,
} from '../ai-credits.js';

type ManagedMode = 'managed' | 'byok';

export async function addLlmRunCost(params: {
  brandId: string;
  runId: string;
  mode: ManagedMode;
  inputTokens?: number | null;
  outputTokens?: number | null;
  model?: string | null;
}): Promise<void> {
  const estimatedUsd = estimateOpenAiTextCostUsd({
    model: params.model,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
  });

  await prisma.recipeRunCost.create({
    data: {
      runId: params.runId,
      provider: 'openai',
      mode: params.mode,
      inputTokens: params.inputTokens ?? 0,
      outputTokens: params.outputTokens ?? 0,
      estimatedCostUsd: estimatedUsd > 0 ? new Prisma.Decimal(estimatedUsd.toFixed(4)) : null,
      notes: params.model ? `model=${params.model}` : null,
    },
  });

  if (params.mode !== 'managed' || estimatedUsd <= 0) {
    return;
  }

  await recordManagedUsageDebit({
    brandId: params.brandId,
    runId: params.runId,
    credits: usdToCredits(estimatedUsd),
    amountUsd: estimatedUsd,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    provider: 'openai',
    note: params.model ? `model=${params.model}` : null,
  });
}

function toRecipeCostProvider(
  provider: string
): 'openai' | 'anthropic' | 'replicate' | 'internal' | 'unknown' {
  switch ((provider || '').trim().toLowerCase()) {
    case 'openai':
      return 'openai';
    case 'anthropic':
      return 'anthropic';
    case 'replicate':
      return 'replicate';
    case 'internal':
      return 'internal';
    default:
      return 'unknown';
  }
}

export async function addSkillRunCost(params: {
  brandId: string;
  runId: string;
  skillId: string;
  mode: ManagedMode;
  provider: string;
  model?: string | null;
}): Promise<void> {
  const estimatedCredits = getEstimatedCreditsForSkillCall(params.skillId);
  const estimatedUsd = getEstimatedUsdForSkillCall(params.skillId);
  const provider = toRecipeCostProvider(params.provider);

  await prisma.recipeRunCost.create({
    data: {
      runId: params.runId,
      provider,
      mode: params.mode,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: estimatedUsd > 0 ? new Prisma.Decimal(estimatedUsd.toFixed(4)) : null,
      notes: params.model
        ? `skill=${params.skillId};model=${params.model}`
        : `skill=${params.skillId}`,
    },
  });

  if (params.mode !== 'managed' || estimatedCredits <= 0 || estimatedUsd <= 0) {
    return;
  }

  await recordManagedUsageDebit({
    brandId: params.brandId,
    runId: params.runId,
    credits: estimatedCredits,
    amountUsd: estimatedUsd,
    inputTokens: 0,
    outputTokens: 0,
    provider,
    note: params.model
      ? `skill=${params.skillId};model=${params.model}`
      : `skill=${params.skillId}`,
  });
}
