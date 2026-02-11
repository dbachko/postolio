import OpenAI from 'openai';
import { prisma } from '../../config/database.js';
import {
  RecipeConfigSchema,
  type RecipeConfig,
  type RecipeStep,
} from '../recipes/config-schema.js';
import { redactSensitive } from './redaction.js';
import { interpolateTemplateString, interpolateUnknown } from './template.js';
import { evalWhen } from './when.js';
import { webFetch } from './skills/web-fetch.js';
import { getDefaultOpenAIModel, getOpenAIClient } from '../openai-client.js';
import { decryptSecret } from '../skills/secret-crypto.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

type RunState = Record<string, unknown>;

const PROMPTS_DIR = fileURLToPath(new URL('./prompts/', import.meta.url));

function now(): Date {
  return new Date();
}

function truncateText(value: string, maxLen = 32_000): string {
  const v = String(value ?? '');
  if (v.length <= maxLen) return v;
  return `${v.slice(0, maxLen)}…`;
}

async function loadPromptTemplate(relativePath: string): Promise<string> {
  let raw = String(relativePath || '').trim();
  raw = raw.replace(/^prompts[\\/]/, '');
  if (raw.startsWith('./')) raw = raw.slice(2);
  if (!raw) throw new Error('prompt_template is empty');
  if (raw.includes('..') || raw.startsWith('/') || raw.startsWith('\\')) {
    throw new Error('prompt_template must be a safe relative path');
  }

  const fullPath = path.resolve(PROMPTS_DIR, raw);
  if (!fullPath.startsWith(PROMPTS_DIR)) {
    throw new Error('prompt_template path traversal is not allowed');
  }

  return await fs.readFile(fullPath, 'utf8');
}

async function resolveOpenAIForBrand(
  brandId: string
): Promise<
  | { mode: 'managed'; client: OpenAI; model: string }
  | { mode: 'byok'; client: OpenAI; model: string }
> {
  const installation = await prisma.skillInstallation.findUnique({
    where: {
      brandId_skillDefinitionId: { brandId, skillDefinitionId: 'openai_text' },
    },
    select: { enabled: true, mode: true, secretId: true, configJson: true },
  });

  if (installation && !installation.enabled) {
    throw new Error('openai_text skill is disabled for this brand');
  }

  const defaultModel = getDefaultOpenAIModel();

  const configuredModel =
    installation?.configJson && typeof installation.configJson === 'object'
      ? ((installation.configJson as any).defaultModel as unknown)
      : undefined;
  const model =
    typeof configuredModel === 'string' && configuredModel.trim().length > 0
      ? configuredModel.trim()
      : defaultModel;

  if (installation?.mode === 'byok') {
    if (!installation.secretId) {
      throw new Error('openai_text is BYOK but no secret is configured');
    }

    const secret = await prisma.encryptedSecret.findUnique({
      where: { id: installation.secretId },
      select: { ciphertext: true, iv: true, tag: true, keyVersion: true },
    });
    if (!secret) {
      throw new Error('Configured BYOK secret was not found');
    }

    const apiKey = decryptSecret({
      ciphertext: Buffer.from(secret.ciphertext),
      iv: Buffer.from(secret.iv),
      tag: Buffer.from(secret.tag),
      keyVersion: secret.keyVersion,
    });

    return { mode: 'byok', client: new OpenAI({ apiKey }), model };
  }

  const managed = getOpenAIClient();
  if (!managed) {
    throw new Error('OPENAI_API_KEY is not configured (managed mode unavailable)');
  }

  return { mode: 'managed', client: managed, model };
}

async function assertSkillEnabled(
  brandId: string,
  skillId: string
): Promise<{ configJson: unknown }> {
  const installation = await prisma.skillInstallation.findUnique({
    where: { brandId_skillDefinitionId: { brandId, skillDefinitionId: skillId } },
    select: { enabled: true, configJson: true },
  });
  if (!installation || !installation.enabled) {
    throw new Error(`Skill is not enabled for this brand: ${skillId}`);
  }
  return { configJson: installation.configJson };
}

async function ensureRunSteps(runId: string, steps: RecipeStep[]) {
  await prisma.recipeRunStep.createMany({
    data: steps.map((s, index) => ({
      runId,
      index,
      type: s.type,
      name: s.name,
      status: 'queued',
    })),
    skipDuplicates: true,
  });
}

async function updateRunStatus(runId: string, data: Record<string, unknown>) {
  await prisma.recipeRun.update({
    where: { id: runId },
    data: data as any,
  });
}

async function isCanceled(runId: string): Promise<boolean> {
  const run = await prisma.recipeRun.findUnique({ where: { id: runId }, select: { status: true } });
  return run?.status === 'canceled';
}

async function updateStep(params: { runId: string; index: number; data: Record<string, unknown> }) {
  await prisma.recipeRunStep.update({
    where: { runId_index: { runId: params.runId, index: params.index } },
    data: params.data as any,
  });
}

async function createArtifact(params: {
  runId: string;
  kind: 'markdown' | 'text' | 'json' | 'asset';
  name: string;
  mimeType?: string | null;
  contentText?: string | null;
  assetId?: string | null;
}) {
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

async function addCost(params: {
  runId: string;
  mode: 'managed' | 'byok';
  inputTokens?: number | null;
  outputTokens?: number | null;
  model?: string | null;
}) {
  await prisma.recipeRunCost.create({
    data: {
      runId: params.runId,
      provider: 'openai',
      mode: params.mode,
      inputTokens: params.inputTokens ?? 0,
      outputTokens: params.outputTokens ?? 0,
      estimatedCostUsd: null,
      notes: params.model ? `model=${params.model}` : null,
    },
  });
}

async function execSkillCall(params: {
  brandId: string;
  skill: string;
  input: unknown;
}): Promise<unknown> {
  if (params.skill === 'web_fetch') {
    const { configJson } = await assertSkillEnabled(params.brandId, 'web_fetch');
    const maxBytesCandidate =
      configJson && typeof configJson === 'object' ? (configJson as any).maxBytes : undefined;
    const maxBytes = typeof maxBytesCandidate === 'number' ? maxBytesCandidate : undefined;

    const url = params.input && typeof params.input === 'object' ? (params.input as any).url : null;
    if (!url || typeof url !== 'string') {
      throw new Error('web_fetch requires input.url');
    }

    const res = await webFetch({ url }, { maxBytes });
    return res.text;
  }

  throw new Error(`Unknown skill: ${params.skill}`);
}

async function execLlmStep(params: {
  runId: string;
  brandId: string;
  config: RecipeConfig;
  step: Extract<RecipeStep, { type: 'llm' }>;
  state: RunState;
  resolvedInput: unknown;
}): Promise<string> {
  const preset = params.config.model_preset;
  const temperature = typeof preset?.temperature === 'number' ? preset.temperature : 0.7;

  const resolvedPrompt =
    params.step.prompt_template != null
      ? await loadPromptTemplate(params.step.prompt_template)
      : String(params.step.prompt || '');

  const promptContext =
    params.resolvedInput &&
    typeof params.resolvedInput === 'object' &&
    !Array.isArray(params.resolvedInput)
      ? { ...params.state, ...(params.resolvedInput as Record<string, unknown>) }
      : params.state;

  const prompt = interpolateTemplateString(resolvedPrompt, promptContext);

  const openai = await resolveOpenAIForBrand(params.brandId);
  const model = preset?.model?.trim() || openai.model;

  const completion = await openai.client.chat.completions.create({
    model,
    temperature,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = completion.choices?.[0]?.message?.content ?? '';

  const usage: any = (completion as any).usage || {};
  await addCost({
    runId: params.runId,
    mode: openai.mode,
    inputTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null,
    outputTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null,
    model,
  });

  return text;
}

export async function executeRecipeRun(runId: string): Promise<{ runId: string; status: string }> {
  const run = await prisma.recipeRun.findUnique({
    where: { id: runId },
    include: {
      recipeTemplateVersion: {
        include: {
          recipeTemplate: { select: { id: true, brandId: true, isCurated: true, status: true } },
        },
      },
    },
  });

  if (!run) {
    return { runId, status: 'not_found' };
  }

  if (run.status !== 'queued') {
    return { runId, status: run.status };
  }

  // Guard against double execution: only transition queued -> running once.
  const started = await prisma.recipeRun.updateMany({
    where: { id: runId, status: 'queued' },
    data: { status: 'running', startedAt: now() },
  });
  if (started.count !== 1) {
    const fresh = await prisma.recipeRun.findUnique({
      where: { id: runId },
      select: { status: true },
    });
    return { runId, status: fresh?.status || 'unknown' };
  }

  const config = RecipeConfigSchema.parse(run.recipeTemplateVersion.configJson) as RecipeConfig;
  const steps = config.steps;

  await ensureRunSteps(runId, steps);

  const state: RunState = {
    input: run.inputJson as any,
  };

  try {
    for (let index = 0; index < steps.length; index++) {
      if (await isCanceled(runId)) {
        await updateRunStatus(runId, { finishedAt: now() });
        return { runId, status: 'canceled' };
      }

      const step = steps[index] as RecipeStep;

      if (!evalWhen(step.when, state)) {
        await updateStep({
          runId,
          index,
          data: {
            status: 'skipped',
            startedAt: now(),
            finishedAt: now(),
            inputJsonRedacted: { when: step.when || null },
          },
        });
        continue;
      }

      const resolvedInput =
        step.type === 'export' ? null : interpolateUnknown((step as any).input, state);

      await updateStep({
        runId,
        index,
        data: {
          status: 'running',
          startedAt: now(),
          inputJsonRedacted: redactSensitive(resolvedInput),
        },
      });

      let output: unknown = null;

      if (step.type === 'transform') {
        const out = interpolateUnknown(step.input || {}, state);
        if (step.output_key) {
          state[step.output_key] = out as any;
          output = out;
        } else if (out && typeof out === 'object' && !Array.isArray(out)) {
          Object.assign(state, out as any);
          output = out;
        } else {
          output = out;
        }
      } else if (step.type === 'skill_call') {
        const res = await execSkillCall({
          brandId: run.brandId,
          skill: step.skill,
          input: resolvedInput,
        });
        const key = step.output_key || `step_${index}_output`;
        state[key] = res as any;
        output = res;
      } else if (step.type === 'llm') {
        const text = await execLlmStep({
          runId,
          brandId: run.brandId,
          config,
          step,
          state,
          resolvedInput,
        });
        const key = step.output_key || `step_${index}_output`;
        state[key] = text;
        output = text;

        if (step.artifact) {
          const artifact = step.artifact;
          const content = artifact.content
            ? interpolateTemplateString(artifact.content, state)
            : text;
          if (artifact.kind === 'asset') {
            await createArtifact({
              runId,
              kind: 'asset',
              name: artifact.name,
              mimeType: artifact.mime_type || null,
              assetId: content || null,
            });
          } else {
            await createArtifact({
              runId,
              kind: artifact.kind,
              name: artifact.name,
              mimeType: artifact.mime_type || null,
              contentText: content || '',
            });
          }
        }
      } else if (step.type === 'export') {
        for (const artifact of step.artifacts) {
          const content = artifact.content
            ? interpolateTemplateString(artifact.content, state)
            : '';
          if (artifact.kind === 'asset') {
            await createArtifact({
              runId,
              kind: 'asset',
              name: artifact.name,
              mimeType: artifact.mime_type || null,
              assetId: content || null,
            });
          } else {
            await createArtifact({
              runId,
              kind: artifact.kind,
              name: artifact.name,
              mimeType: artifact.mime_type || null,
              contentText: content,
            });
          }
        }
        output = { artifacts: step.artifacts.map((a) => ({ kind: a.kind, name: a.name })) };
      }

      await updateStep({
        runId,
        index,
        data: {
          status: 'success',
          finishedAt: now(),
          outputJsonRedacted: redactSensitive(output),
        },
      });
    }

    await updateRunStatus(runId, { status: 'success', finishedAt: now() });
    return { runId, status: 'success' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await updateRunStatus(runId, {
      status: 'failed',
      finishedAt: now(),
      errorCode: 'RECIPE_RUN_FAILED',
      errorMessage: 'Run failed. Please try again or edit the recipe.',
      internalError: truncateText(message, 4000),
    });

    // Best-effort mark current step failed (find first running step).
    try {
      const runningStep = await prisma.recipeRunStep.findFirst({
        where: { runId, status: 'running' },
        select: { index: true },
        orderBy: { index: 'desc' },
      });
      if (runningStep) {
        await updateStep({
          runId,
          index: runningStep.index,
          data: {
            status: 'failed',
            finishedAt: now(),
            errorMessage: truncateText(message, 2000),
          },
        });
      }
    } catch {
      // ignore
    }

    return { runId, status: 'failed' };
  }
}
