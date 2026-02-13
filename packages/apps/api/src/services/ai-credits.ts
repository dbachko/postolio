import { Prisma } from '@postolio/database';
import { prisma } from '../config/database.js';
import type { RecipeConfig, RecipeStep } from './recipes/config-schema.js';

const USD_PER_CREDIT = 0.01;
const BASE_RUN_CREDITS = 5;

const ESTIMATE_COST_CREDITS = {
  llm: 25,
  webFetch: 1,
  image: 90,
  video: 260,
  audio: 60,
} as const;

const SKILL_ID_TO_ESTIMATE_KEY = {
  text_generation: 'llm',
  web_fetch: 'webFetch',
  image_generation: 'image',
  video_gen: 'video',
  audio_gen: 'audio',
} as const;

type StepCounts = {
  llmCalls: number;
  webFetchCalls: number;
  imageCalls: number;
  videoCalls: number;
  audioCalls: number;
};

export type RecipeCreditEstimate = {
  cadenceCount: number;
  stepCounts: StepCounts;
  billableCounts: StepCounts;
  estimatedCredits: number;
  estimatedUsd: string;
};

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export function isAiCreditEnforcementEnabled(): boolean {
  return (
    String(process.env.AI_CREDITS_ENFORCE || '')
      .trim()
      .toLowerCase() === 'true'
  );
}

function getDefaultStartingCredits(): number {
  return parsePositiveInt(process.env.AI_CREDITS_DEFAULT_STARTING, 1000);
}

function toFixedUsd(value: number): string {
  return value.toFixed(4);
}

export function creditsToUsd(credits: number): string {
  if (!Number.isFinite(credits) || credits <= 0) return '0.0000';
  return toFixedUsd((Math.floor(credits) * USD_PER_CREDIT) / 1);
}

export function usdToCredits(usdAmount: number): number {
  if (!Number.isFinite(usdAmount) || usdAmount <= 0) return 0;
  return Math.max(1, Math.ceil(usdAmount / USD_PER_CREDIT));
}

export function getEstimatedCreditsForSkillCall(skillId: string): number {
  const key = SKILL_ID_TO_ESTIMATE_KEY[skillId as keyof typeof SKILL_ID_TO_ESTIMATE_KEY] || null;
  if (!key) return 0;
  return ESTIMATE_COST_CREDITS[key];
}

export function getEstimatedUsdForSkillCall(skillId: string): number {
  const credits = getEstimatedCreditsForSkillCall(skillId);
  if (credits <= 0) return 0;
  return Number((credits * USD_PER_CREDIT).toFixed(4));
}

function inferCadenceCount(config: RecipeConfig, input: unknown): number {
  const inputRecord =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : null;

  const fromInputPostCountRaw =
    inputRecord?.post_count ?? inputRecord?.rolling_post_limit ?? inputRecord?.count;
  const fromInputPostCount =
    typeof fromInputPostCountRaw === 'number'
      ? fromInputPostCountRaw
      : typeof fromInputPostCountRaw === 'string'
        ? Number.parseInt(fromInputPostCountRaw, 10)
        : null;
  if (fromInputPostCount && Number.isFinite(fromInputPostCount) && fromInputPostCount > 0) {
    return Math.max(1, Math.floor(fromInputPostCount));
  }

  const fromCadence =
    config?.cadence &&
    typeof config.cadence === 'object' &&
    typeof config.cadence.count === 'number'
      ? config.cadence.count
      : null;
  if (fromCadence && Number.isFinite(fromCadence) && fromCadence > 0) {
    return Math.max(1, Math.floor(fromCadence));
  }

  const fromSummary =
    config?.summary &&
    typeof config.summary === 'object' &&
    typeof config.summary.postsCount === 'number'
      ? config.summary.postsCount
      : null;
  if (fromSummary && Number.isFinite(fromSummary) && fromSummary > 0) {
    return Math.max(1, Math.floor(fromSummary));
  }

  return 1;
}

function addStepCount(counts: StepCounts, step: RecipeStep, multiplier: number): void {
  if (step.type === 'llm') {
    counts.llmCalls += multiplier;
    return;
  }

  if (step.type === 'skill_call') {
    switch (step.skill) {
      case 'web_fetch':
        counts.webFetchCalls += multiplier;
        break;
      case 'image_generation':
        counts.imageCalls += multiplier;
        break;
      case 'video_gen':
        counts.videoCalls += multiplier;
        break;
      case 'audio_gen':
        counts.audioCalls += multiplier;
        break;
      default:
        break;
    }
    return;
  }
}

function collectStepCounts(
  steps: RecipeStep[],
  cadenceCount: number,
  multiplier: number,
  counts: StepCounts
): void {
  for (const step of steps) {
    addStepCount(counts, step, multiplier);
    if (step.type === 'foreach') {
      collectStepCounts(step.do, cadenceCount, multiplier * cadenceCount, counts);
    }
  }
}

function emptyStepCounts(): StepCounts {
  return {
    llmCalls: 0,
    webFetchCalls: 0,
    imageCalls: 0,
    videoCalls: 0,
    audioCalls: 0,
  };
}

export function estimateRecipeCredits(params: {
  config: RecipeConfig;
  input?: unknown;
  managedSkillIds?: Set<string>;
}): RecipeCreditEstimate {
  const cadenceCount = inferCadenceCount(params.config, params.input);
  const stepCounts = emptyStepCounts();
  collectStepCounts(params.config.steps, cadenceCount, 1, stepCounts);

  const managed = params.managedSkillIds || new Set<string>();
  const billableCounts: StepCounts = {
    llmCalls: managed.has('text_generation') ? stepCounts.llmCalls : 0,
    webFetchCalls: managed.has('web_fetch') ? stepCounts.webFetchCalls : 0,
    imageCalls: managed.has('image_generation') ? stepCounts.imageCalls : 0,
    videoCalls: managed.has('video_gen') ? stepCounts.videoCalls : 0,
    audioCalls: managed.has('audio_gen') ? stepCounts.audioCalls : 0,
  };

  const variableCredits =
    billableCounts.llmCalls * ESTIMATE_COST_CREDITS.llm +
    billableCounts.webFetchCalls * ESTIMATE_COST_CREDITS.webFetch +
    billableCounts.imageCalls * ESTIMATE_COST_CREDITS.image +
    billableCounts.videoCalls * ESTIMATE_COST_CREDITS.video +
    billableCounts.audioCalls * ESTIMATE_COST_CREDITS.audio;

  const hasBillableWork = variableCredits > 0;
  const estimatedCredits = hasBillableWork ? BASE_RUN_CREDITS + variableCredits : 0;

  return {
    cadenceCount,
    stepCounts,
    billableCounts,
    estimatedCredits,
    estimatedUsd: creditsToUsd(estimatedCredits),
  };
}

function pricingForOpenAiTextModel(modelRaw: string | null | undefined): {
  inputPer1KUsd: number;
  outputPer1KUsd: number;
} {
  const model = String(modelRaw || '')
    .trim()
    .toLowerCase();
  if (!model) return { inputPer1KUsd: 0.00015, outputPer1KUsd: 0.0006 };

  if (model.includes('gpt-4o-mini')) return { inputPer1KUsd: 0.00015, outputPer1KUsd: 0.0006 };
  if (model.includes('gpt-4.1-mini')) return { inputPer1KUsd: 0.0004, outputPer1KUsd: 0.0016 };
  if (model.includes('gpt-4.1-nano')) return { inputPer1KUsd: 0.0001, outputPer1KUsd: 0.0004 };
  if (model.includes('gpt-4o')) return { inputPer1KUsd: 0.005, outputPer1KUsd: 0.015 };

  return { inputPer1KUsd: 0.00015, outputPer1KUsd: 0.0006 };
}

export function estimateOpenAiTextCostUsd(params: {
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}): number {
  const inputTokens =
    typeof params.inputTokens === 'number' &&
    Number.isFinite(params.inputTokens) &&
    params.inputTokens > 0
      ? params.inputTokens
      : 0;
  const outputTokens =
    typeof params.outputTokens === 'number' &&
    Number.isFinite(params.outputTokens) &&
    params.outputTokens > 0
      ? params.outputTokens
      : 0;

  if (inputTokens === 0 && outputTokens === 0) return 0;
  const pricing = pricingForOpenAiTextModel(params.model);
  const inputUsd = (inputTokens / 1000) * pricing.inputPer1KUsd;
  const outputUsd = (outputTokens / 1000) * pricing.outputPer1KUsd;
  return Number((inputUsd + outputUsd).toFixed(6));
}

async function ensureWalletTx(tx: Prisma.TransactionClient, brandId: string) {
  const existing = await tx.brandAiCreditWallet.findUnique({
    where: { brandId },
    select: {
      brandId: true,
      balanceCredits: true,
      totalGrantedCredits: true,
      totalDebitedCredits: true,
    },
  });
  if (existing) return existing;

  const initialCredits = getDefaultStartingCredits();
  const created = await tx.brandAiCreditWallet.create({
    data: {
      brandId,
      balanceCredits: initialCredits,
      totalGrantedCredits: initialCredits,
      totalDebitedCredits: 0,
    },
    select: {
      brandId: true,
      balanceCredits: true,
      totalGrantedCredits: true,
      totalDebitedCredits: true,
    },
  });

  if (initialCredits > 0) {
    await tx.aICreditLedgerEntry.create({
      data: {
        brandId,
        type: 'grant',
        deltaCredits: initialCredits,
        amountUsd: new Prisma.Decimal(creditsToUsd(initialCredits)),
        provider: 'internal',
        mode: 'managed',
        note: 'Initial credit allocation',
      },
    });
  }

  return created;
}

export async function ensureAiCreditsWalletInitialized(params: {
  brandId: string;
  tx?: Prisma.TransactionClient;
}) {
  if (params.tx) {
    return await ensureWalletTx(params.tx, params.brandId);
  }
  return await prisma.$transaction(async (tx) => ensureWalletTx(tx, params.brandId));
}

export async function getAiCreditsSummary(brandId: string): Promise<{
  balanceCredits: number;
  totalGrantedCredits: number;
  totalDebitedCredits: number;
  enforcementEnabled: boolean;
}> {
  const wallet = await ensureAiCreditsWalletInitialized({ brandId });
  return {
    balanceCredits: wallet.balanceCredits,
    totalGrantedCredits: wallet.totalGrantedCredits,
    totalDebitedCredits: wallet.totalDebitedCredits,
    enforcementEnabled: isAiCreditEnforcementEnabled(),
  };
}

export async function topUpAiCredits(params: {
  brandId: string;
  credits: number;
  note?: string | null;
}): Promise<{
  balanceCredits: number;
  grantedCredits: number;
}> {
  const credits = Math.max(1, Math.floor(params.credits));
  const wallet = await prisma.$transaction(async (tx) => {
    await ensureWalletTx(tx, params.brandId);
    const updated = await tx.brandAiCreditWallet.update({
      where: { brandId: params.brandId },
      data: {
        balanceCredits: { increment: credits },
        totalGrantedCredits: { increment: credits },
      },
      select: { balanceCredits: true },
    });

    await tx.aICreditLedgerEntry.create({
      data: {
        brandId: params.brandId,
        type: 'grant',
        deltaCredits: credits,
        amountUsd: new Prisma.Decimal(creditsToUsd(credits)),
        provider: 'internal',
        mode: 'managed',
        note: params.note?.trim() || 'Manual top-up',
      },
    });

    return updated;
  });

  return { balanceCredits: wallet.balanceCredits, grantedCredits: credits };
}

export async function recordManagedUsageDebit(params: {
  brandId: string;
  runId: string;
  credits: number;
  amountUsd: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  provider?: 'openai' | 'anthropic' | 'replicate' | 'internal' | 'unknown';
  note?: string | null;
}): Promise<{ balanceCredits: number; debitedCredits: number }> {
  const debitedCredits = Math.max(0, Math.floor(params.credits));
  if (debitedCredits <= 0) {
    const summary = await getAiCreditsSummary(params.brandId);
    return { balanceCredits: summary.balanceCredits, debitedCredits: 0 };
  }

  return await prisma.$transaction(async (tx) => {
    const wallet = await ensureWalletTx(tx, params.brandId);
    if (isAiCreditEnforcementEnabled() && wallet.balanceCredits < debitedCredits) {
      throw new Error(
        `INSUFFICIENT_AI_CREDITS:${wallet.balanceCredits}:${debitedCredits}:${debitedCredits - wallet.balanceCredits}`
      );
    }

    const updated = await tx.brandAiCreditWallet.update({
      where: { brandId: params.brandId },
      data: {
        balanceCredits: { decrement: debitedCredits },
        totalDebitedCredits: { increment: debitedCredits },
      },
      select: { balanceCredits: true },
    });

    await tx.aICreditLedgerEntry.create({
      data: {
        brandId: params.brandId,
        runId: params.runId,
        type: 'debit',
        deltaCredits: -debitedCredits,
        amountUsd: new Prisma.Decimal(toFixedUsd(Math.max(0, params.amountUsd || 0))),
        inputTokens:
          typeof params.inputTokens === 'number' && Number.isFinite(params.inputTokens)
            ? Math.max(0, Math.floor(params.inputTokens))
            : 0,
        outputTokens:
          typeof params.outputTokens === 'number' && Number.isFinite(params.outputTokens)
            ? Math.max(0, Math.floor(params.outputTokens))
            : 0,
        provider: params.provider || 'unknown',
        mode: 'managed',
        note: params.note?.trim() || null,
      },
    });

    return { balanceCredits: updated.balanceCredits, debitedCredits };
  });
}

export async function getRunManagedCreditsSpent(runId: string): Promise<number> {
  const aggregate = await prisma.aICreditLedgerEntry.aggregate({
    where: { runId, type: 'debit' },
    _sum: { deltaCredits: true },
  });
  const deltaSum = aggregate._sum.deltaCredits || 0;
  return Math.abs(Math.min(0, deltaSum));
}
