import { interpolateTemplateString, interpolateUnknown } from './template.js';
import { executeSkillCall } from './skills/index.js';
import { addSkillRunCost } from './run-executor-costs.js';
import { createRunArtifact } from './run-executor-persistence.js';
import { executeContentCreateStep } from './run-executor-content-create.js';
import { executeForeachStep } from './run-executor-foreach.js';
import { execLlmStep } from './run-executor-llm.js';
import type { RecipeStep } from '../recipes/config-schema.js';
import type { ExecuteStepContext, RunState } from './run-executor-types.js';

export function resolveStepInput(step: RecipeStep, state: RunState): unknown {
  if (step.type === 'export') {
    return null;
  }

  if (step.type === 'foreach') {
    return interpolateUnknown((step as any).items, state);
  }

  return interpolateUnknown((step as any).input, state);
}

async function executeTransformStep(params: {
  step: Extract<RecipeStep, { type: 'transform' }>;
  state: RunState;
}): Promise<unknown> {
  const output = interpolateUnknown(params.step.input || {}, params.state);
  if (params.step.output_key) {
    params.state[params.step.output_key] = output as any;
    return output;
  }

  if (output && typeof output === 'object' && !Array.isArray(output)) {
    Object.assign(params.state, output as Record<string, unknown>);
  }

  return output;
}

async function executeSkillCallStep(params: {
  ctx: ExecuteStepContext;
  step: Extract<RecipeStep, { type: 'skill_call' }>;
  state: RunState;
  defaultOutputKey: string;
  resolvedInput: unknown;
}): Promise<unknown> {
  const result = await executeSkillCall({
    brandId: params.ctx.runBrandId,
    skillId: params.step.skill,
    input: params.resolvedInput,
  });
  await addSkillRunCost({
    brandId: params.ctx.runBrandId,
    runId: params.ctx.runId,
    skillId: params.step.skill,
    mode: result.mode,
    provider: result.provider,
    model: result.model || null,
  });

  const outputKey = params.step.output_key || params.defaultOutputKey;
  params.state[outputKey] = result.output as any;
  return result.output;
}

async function persistLlmArtifact(params: {
  ctx: ExecuteStepContext;
  step: Extract<RecipeStep, { type: 'llm' }>;
  state: RunState;
  llmOutput: unknown;
}): Promise<void> {
  if (!params.step.artifact) {
    return;
  }

  const artifact = params.step.artifact;
  const resolved = artifact.content
    ? interpolateTemplateString(artifact.content, params.state)
    : params.llmOutput;
  const content = typeof resolved === 'string' ? resolved : JSON.stringify(resolved);

  if (artifact.kind === 'asset') {
    await createRunArtifact({
      runId: params.ctx.runId,
      kind: 'asset',
      name: artifact.name,
      mimeType: artifact.mime_type || null,
      assetId: content || null,
    });
    return;
  }

  await createRunArtifact({
    runId: params.ctx.runId,
    kind: artifact.kind,
    name: artifact.name,
    mimeType: artifact.mime_type || null,
    contentText: content || '',
  });
}

async function executeLlmRuntimeStep(params: {
  ctx: ExecuteStepContext;
  step: Extract<RecipeStep, { type: 'llm' }>;
  state: RunState;
  defaultOutputKey: string;
  resolvedInput: unknown;
}): Promise<unknown> {
  const output = await execLlmStep({
    runId: params.ctx.runId,
    brandId: params.ctx.runBrandId,
    config: params.ctx.config,
    step: params.step,
    state: params.state,
    resolvedInput: params.resolvedInput,
  });

  const outputKey = params.step.output_key || params.defaultOutputKey;
  params.state[outputKey] = output as any;
  await persistLlmArtifact({
    ctx: params.ctx,
    step: params.step,
    state: params.state,
    llmOutput: output,
  });
  return output;
}

async function executeExportStep(params: {
  ctx: ExecuteStepContext;
  step: Extract<RecipeStep, { type: 'export' }>;
  state: RunState;
}): Promise<unknown> {
  for (const artifact of params.step.artifacts) {
    const content = artifact.content
      ? interpolateTemplateString(artifact.content, params.state)
      : '';
    if (artifact.kind === 'asset') {
      await createRunArtifact({
        runId: params.ctx.runId,
        kind: 'asset',
        name: artifact.name,
        mimeType: artifact.mime_type || null,
        assetId: content || null,
      });
      continue;
    }

    await createRunArtifact({
      runId: params.ctx.runId,
      kind: artifact.kind,
      name: artifact.name,
      mimeType: artifact.mime_type || null,
      contentText: content,
    });
  }

  return {
    artifacts: params.step.artifacts.map((artifact) => ({
      kind: artifact.kind,
      name: artifact.name,
    })),
  };
}

export async function executeRuntimeStep(params: {
  ctx: ExecuteStepContext;
  step: RecipeStep;
  state: RunState;
  defaultOutputKey: string;
}): Promise<unknown> {
  const resolvedInput = resolveStepInput(params.step, params.state);
  switch (params.step.type) {
    case 'transform':
      return executeTransformStep({
        step: params.step,
        state: params.state,
      });
    case 'skill_call':
      return executeSkillCallStep({
        ctx: params.ctx,
        step: params.step,
        state: params.state,
        defaultOutputKey: params.defaultOutputKey,
        resolvedInput,
      });
    case 'llm':
      return executeLlmRuntimeStep({
        ctx: params.ctx,
        step: params.step,
        state: params.state,
        defaultOutputKey: params.defaultOutputKey,
        resolvedInput,
      });
    case 'export':
      return executeExportStep({ ctx: params.ctx, step: params.step, state: params.state });
    case 'content_create':
      return executeContentCreateStep({
        ctx: params.ctx,
        step: params.step,
        state: params.state,
        defaultOutputKey: params.defaultOutputKey,
        resolvedInput,
      });
    case 'foreach':
      return executeForeachStep({
        ctx: params.ctx,
        step: params.step,
        state: params.state,
        resolvedInput,
        defaultOutputKey: params.defaultOutputKey,
        executeRuntimeStep,
      });
    default:
      return null;
  }
}
