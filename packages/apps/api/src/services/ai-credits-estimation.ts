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

function toFixedUsd(value: number): string {
  return value.toFixed(4);
}

function creditsToUsd(credits: number): string {
  if (!Number.isFinite(credits) || credits <= 0) {
    return '0.0000';
  }

  return toFixedUsd(Math.floor(credits) * USD_PER_CREDIT);
}

export function getEstimatedCreditsForSkillCall(skillId: string): number {
  const key = SKILL_ID_TO_ESTIMATE_KEY[skillId as keyof typeof SKILL_ID_TO_ESTIMATE_KEY] || null;
  if (!key) {
    return 0;
  }

  return ESTIMATE_COST_CREDITS[key];
}

export function getEstimatedUsdForSkillCall(skillId: string): number {
  const credits = getEstimatedCreditsForSkillCall(skillId);
  if (credits <= 0) {
    return 0;
  }

  return Number((credits * USD_PER_CREDIT).toFixed(4));
}

function normalizePositiveCount(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.max(1, Math.floor(value));
}

function parsePositiveCount(value: unknown): number | null {
  if (typeof value === 'number') {
    return normalizePositiveCount(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return normalizePositiveCount(parsed);
  }
  return null;
}

function toInputRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}

function countFromInput(input: unknown): number | null {
  const inputRecord = toInputRecord(input);
  if (!inputRecord) {
    return null;
  }

  return (
    parsePositiveCount(inputRecord.post_count) ??
    parsePositiveCount(inputRecord.rolling_post_limit) ??
    parsePositiveCount(inputRecord.count)
  );
}

function countFromCadenceConfig(config: RecipeConfig): number | null {
  if (!config?.cadence || typeof config.cadence !== 'object') {
    return null;
  }
  return parsePositiveCount(config.cadence.count);
}

function countFromSummaryConfig(config: RecipeConfig): number | null {
  if (!config?.summary || typeof config.summary !== 'object') {
    return null;
  }
  return parsePositiveCount(config.summary.postsCount);
}

function inferCadenceCount(config: RecipeConfig, input: unknown): number {
  return (
    countFromInput(input) ?? countFromCadenceConfig(config) ?? countFromSummaryConfig(config) ?? 1
  );
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

  const estimatedCredits = variableCredits > 0 ? BASE_RUN_CREDITS + variableCredits : 0;

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
  if (!model || model.includes('gpt-4o-mini')) {
    return { inputPer1KUsd: 0.00015, outputPer1KUsd: 0.0006 };
  }
  if (model.includes('gpt-4.1-mini')) {
    return { inputPer1KUsd: 0.0004, outputPer1KUsd: 0.0016 };
  }
  if (model.includes('gpt-4.1-nano')) {
    return { inputPer1KUsd: 0.0001, outputPer1KUsd: 0.0004 };
  }
  if (model.includes('gpt-4o')) {
    return { inputPer1KUsd: 0.005, outputPer1KUsd: 0.015 };
  }

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

  if (inputTokens === 0 && outputTokens === 0) {
    return 0;
  }

  const pricing = pricingForOpenAiTextModel(params.model);
  const inputUsd = (inputTokens / 1000) * pricing.inputPer1KUsd;
  const outputUsd = (outputTokens / 1000) * pricing.outputPer1KUsd;
  return Number((inputUsd + outputUsd).toFixed(6));
}
