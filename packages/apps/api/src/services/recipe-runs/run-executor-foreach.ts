import type { RecipeStep } from '../recipes/config-schema.js';
import { evalWhen } from './when.js';
import { parseJsonArrayCandidate } from './run-executor-shared.js';
import type { ExecuteStepContext, RunState } from './run-executor-types.js';

type ForeachStep = Extract<RecipeStep, { type: 'foreach' }>;
type RuntimeStepExecutor = (params: {
  ctx: ExecuteStepContext;
  step: RecipeStep;
  state: RunState;
  defaultOutputKey: string;
}) => Promise<unknown>;

type ForeachStateSnapshot = {
  itemKey: string;
  indexKey: string;
  hadPrevItem: boolean;
  hadPrevIndex: boolean;
  prevItem: unknown;
  prevIndex: unknown;
};

function resolveForeachItems(resolvedInput: unknown): unknown[] {
  if (Array.isArray(resolvedInput)) {
    return resolvedInput;
  }

  const parsed = parseJsonArrayCandidate(resolvedInput);
  if (parsed.length === 0) {
    throw new Error('foreach requires items to resolve to an array');
  }
  return parsed;
}

function snapshotForeachState(step: ForeachStep, state: RunState): ForeachStateSnapshot {
  const itemKey = step.item_key?.trim() || 'item';
  const indexKey = step.index_key?.trim() || 'item_index';
  return {
    itemKey,
    indexKey,
    hadPrevItem: Object.prototype.hasOwnProperty.call(state, itemKey),
    hadPrevIndex: Object.prototype.hasOwnProperty.call(state, indexKey),
    prevItem: state[itemKey],
    prevIndex: state[indexKey],
  };
}

function restoreForeachState(state: RunState, snapshot: ForeachStateSnapshot): void {
  if (snapshot.hadPrevItem) {
    state[snapshot.itemKey] = snapshot.prevItem;
  } else {
    delete state[snapshot.itemKey];
  }

  if (snapshot.hadPrevIndex) {
    state[snapshot.indexKey] = snapshot.prevIndex;
  } else {
    delete state[snapshot.indexKey];
  }
}

async function executeForeachIteration(params: {
  ctx: ExecuteStepContext;
  step: ForeachStep;
  state: RunState;
  iterationIndex: number;
  itemKey: string;
  indexKey: string;
  item: unknown;
  defaultOutputKey: string;
  executeRuntimeStep: RuntimeStepExecutor;
}): Promise<Record<string, unknown>> {
  params.state[params.itemKey] = params.item;
  params.state[params.indexKey] = params.iterationIndex;

  const iterOutput: Record<string, unknown> = { index: params.iterationIndex };
  for (let childIndex = 0; childIndex < params.step.do.length; childIndex++) {
    const childStep = params.step.do[childIndex] as RecipeStep;
    if (!evalWhen(childStep.when, params.state)) {
      continue;
    }

    const childOutput = await params.executeRuntimeStep({
      ctx: params.ctx,
      step: childStep,
      state: params.state,
      defaultOutputKey: `${params.defaultOutputKey}_i${params.iterationIndex}_s${childIndex}`,
    });
    const explicitOutputKey = (childStep as any).output_key as string | undefined;
    if (typeof explicitOutputKey === 'string' && explicitOutputKey.trim().length > 0) {
      iterOutput[explicitOutputKey.trim()] = params.state[explicitOutputKey.trim()];
    } else {
      iterOutput[`step_${childIndex}`] = childOutput;
    }
  }

  return iterOutput;
}

export async function executeForeachStep(params: {
  ctx: ExecuteStepContext;
  step: ForeachStep;
  state: RunState;
  resolvedInput: unknown;
  defaultOutputKey: string;
  executeRuntimeStep: RuntimeStepExecutor;
}): Promise<unknown> {
  const items = resolveForeachItems(params.resolvedInput);
  const snapshot = snapshotForeachState(params.step, params.state);
  const iterationOutputs: Array<Record<string, unknown>> = [];

  try {
    for (let i = 0; i < items.length; i++) {
      const iterOutput = await executeForeachIteration({
        ctx: params.ctx,
        step: params.step,
        state: params.state,
        iterationIndex: i,
        itemKey: snapshot.itemKey,
        indexKey: snapshot.indexKey,
        item: items[i],
        defaultOutputKey: params.defaultOutputKey,
        executeRuntimeStep: params.executeRuntimeStep,
      });
      iterationOutputs.push(iterOutput);
    }
  } finally {
    restoreForeachState(params.state, snapshot);
  }

  if (params.step.output_key) {
    params.state[params.step.output_key] = iterationOutputs as any;
  }

  return { iterations: items.length };
}
