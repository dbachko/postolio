import { interpolateTemplateString } from './template.js';
import { resolveOpenAIForSkill } from './skills/runtime.js';
import type { RecipeConfig, RecipeStep } from '../recipes/config-schema.js';
import { addLlmRunCost } from './run-executor-costs.js';
import type { RunState } from './run-executor-types.js';
import { loadPromptTemplate } from './run-executor-shared.js';

function isStructuredOutputStep(step: unknown): step is { structured_output: unknown } {
  return Boolean(step && typeof step === 'object' && (step as any).structured_output);
}

function resolvePromptContext(state: RunState, resolvedInput: unknown): RunState {
  if (!resolvedInput || typeof resolvedInput !== 'object' || Array.isArray(resolvedInput)) {
    return state;
  }
  return { ...state, ...(resolvedInput as Record<string, unknown>) };
}

function resolveResponseFormat(step: Extract<RecipeStep, { type: 'llm' }>, runId: string) {
  if (!isStructuredOutputStep(step)) {
    return undefined;
  }

  const spec = (step as any).structured_output || null;
  if (!spec || typeof spec !== 'object') {
    return undefined;
  }

  const schema = (spec as any).schema;
  if (!schema) {
    return undefined;
  }

  const providedName = (spec as any).name;
  const schemaName =
    typeof providedName === 'string' && providedName.trim().length > 0
      ? providedName.trim()
      : `recipe_${runId}_step_${String((step as any).name || 'output').replace(/\s+/g, '_')}`;
  const strict = typeof (spec as any).strict === 'boolean' ? (spec as any).strict : true;

  return {
    type: 'json_schema',
    json_schema: {
      name: schemaName,
      strict,
      schema,
    },
  };
}

async function resolvePrompt(step: Extract<RecipeStep, { type: 'llm' }>, context: RunState) {
  const source =
    step.prompt_template != null
      ? await loadPromptTemplate(step.prompt_template)
      : String(step.prompt || '');
  return interpolateTemplateString(source, context);
}

export async function execLlmStep(params: {
  runId: string;
  brandId: string;
  config: RecipeConfig;
  step: Extract<RecipeStep, { type: 'llm' }>;
  state: RunState;
  resolvedInput: unknown;
}): Promise<unknown> {
  const preset = params.config.model_preset;
  const structuredOutputRequested = isStructuredOutputStep(params.step);
  const temperature =
    typeof preset?.temperature === 'number'
      ? preset.temperature
      : structuredOutputRequested
        ? 0
        : 0.7;
  const promptContext = resolvePromptContext(params.state, params.resolvedInput);
  const prompt = await resolvePrompt(params.step, promptContext);

  const openai = await resolveOpenAIForSkill(params.brandId, 'text_generation');
  const model = preset?.model?.trim() || openai.defaultModel;
  const responseFormat = resolveResponseFormat(params.step, params.runId);

  const completion = await openai.client.chat.completions.create({
    model,
    temperature,
    messages: [{ role: 'user', content: prompt }],
    ...(responseFormat ? ({ response_format: responseFormat } as any) : {}),
  });

  const text = completion.choices?.[0]?.message?.content ?? '';
  const usage: any = (completion as any).usage || {};
  await addLlmRunCost({
    brandId: params.brandId,
    runId: params.runId,
    mode: openai.mode,
    inputTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null,
    outputTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null,
    model,
  });

  if (!responseFormat) {
    return text;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Structured output was requested but the model did not return valid JSON');
  }
}
