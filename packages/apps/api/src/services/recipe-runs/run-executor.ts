import { Prisma } from '@postolio/database';
import { prisma } from '../../config/database.js';
import {
  RecipeConfigSchema,
  type RecipeConfig,
  type RecipeStep,
} from '../recipes/config-schema.js';
import { redactSensitive } from './redaction.js';
import { interpolateTemplateString, interpolateUnknown } from './template.js';
import { evalWhen } from './when.js';
import { executeSkillCall } from './skills/index.js';
import { resolveOpenAIForSkill } from './skills/runtime.js';
import {
  estimateOpenAiTextCostUsd,
  getEstimatedCreditsForSkillCall,
  getEstimatedUsdForSkillCall,
  recordManagedUsageDebit,
  usdToCredits,
} from '../ai-credits.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { TimezoneService } from '../timezone.js';
import { formatInTimeZone } from 'date-fns-tz';
import { isMultiDestinationEnabledForUser } from '../../utils/feature-flags.js';

type RunState = Record<string, unknown>;

const PROMPTS_DIR = fileURLToPath(new URL('./prompts/', import.meta.url));

function now(): Date {
  return new Date();
}

function truncateText(value: string, maxLen = 32_000): string {
  const v = String(value ?? '');
  if (v.length <= maxLen) {
    return v;
  }
  return `${v.slice(0, maxLen)}…`;
}

function isYmd(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map((n) => Number.parseInt(n, 10));
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function extractHashtagsFromCaption(caption: string): string[] {
  const matches = String(caption || '').match(/#[a-zA-Z0-9_]+/g) || [];
  // De-dupe while preserving order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of matches) {
    const h = raw.replace(/^#/, '').trim();
    if (!h) {
      continue;
    }
    if (seen.has(h)) {
      continue;
    }
    seen.add(h);
    out.push(h);
  }
  return out;
}

function stripMarkdownCodeFence(input: string): string {
  const raw = String(input || '').trim();
  if (!raw.startsWith('```')) {
    return raw;
  }

  // Common LLM behavior: wrap JSON in ```json ... ``` fences.
  // Only strip when the fence is at the beginning to avoid mangling legitimate content.
  const firstNewline = raw.indexOf('\n');
  if (firstNewline < 0) {
    return raw;
  }
  const withoutHeader = raw.slice(firstNewline + 1);
  const fenceEnd = withoutHeader.lastIndexOf('```');
  if (fenceEnd < 0) {
    return raw;
  }
  return withoutHeader.slice(0, fenceEnd).trim();
}

function extractJsonArraySubstring(input: string): string | null {
  const raw = String(input || '');
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end < 0 || end <= start) {
    return null;
  }
  return raw.slice(start, end + 1).trim();
}

function parsePostsJsonCandidate(value: unknown): any[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === 'object') {
    const maybePosts = (value as any).posts;
    if (Array.isArray(maybePosts)) {
      return maybePosts;
    }
  }
  if (typeof value !== 'string') {
    return [];
  }

  const raw = value.trim();
  if (!raw) {
    return [];
  }

  const candidates = Array.from(
    new Set(
      [
        raw,
        stripMarkdownCodeFence(raw),
        extractJsonArraySubstring(raw),
        extractJsonArraySubstring(stripMarkdownCodeFence(raw)),
      ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    )
  );

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      if (parsed && typeof parsed === 'object') {
        const maybePosts = (parsed as any).posts;
        if (Array.isArray(maybePosts)) {
          return maybePosts;
        }
      }
    } catch {
      // keep trying other candidates
    }
  }

  return [];
}

function parseJsonArrayCandidate(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === 'object') {
    const maybeItems = (value as any).items;
    if (Array.isArray(maybeItems)) {
      return maybeItems;
    }
    const maybePosts = (value as any).posts;
    if (Array.isArray(maybePosts)) {
      return maybePosts;
    }
  }
  if (typeof value !== 'string') {
    return [];
  }

  const raw = value.trim();
  if (!raw) {
    return [];
  }

  const candidates = Array.from(
    new Set(
      [
        raw,
        stripMarkdownCodeFence(raw),
        extractJsonArraySubstring(raw),
        extractJsonArraySubstring(stripMarkdownCodeFence(raw)),
      ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    )
  );

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      if (parsed && typeof parsed === 'object') {
        const maybeItems = (parsed as any).items;
        if (Array.isArray(maybeItems)) {
          return maybeItems;
        }
        const maybePosts = (parsed as any).posts;
        if (Array.isArray(maybePosts)) {
          return maybePosts;
        }
      }
    } catch {
      // keep trying other candidates
    }
  }

  return [];
}

async function loadPromptTemplate(relativePath: string): Promise<string> {
  let raw = String(relativePath || '').trim();
  raw = raw.replace(/^prompts[\\/]/, '');
  if (raw.startsWith('./')) {
    raw = raw.slice(2);
  }
  if (!raw) {
    throw new Error('prompt_template is empty');
  }
  if (raw.includes('..') || raw.startsWith('/') || raw.startsWith('\\')) {
    throw new Error('prompt_template must be a safe relative path');
  }

  const fullPath = path.resolve(PROMPTS_DIR, raw);
  if (!fullPath.startsWith(PROMPTS_DIR)) {
    throw new Error('prompt_template path traversal is not allowed');
  }

  return await fs.readFile(fullPath, 'utf8');
}

function isStructuredOutputStep(step: unknown): step is { structured_output: any } {
  return Boolean(step && typeof step === 'object' && (step as any).structured_output);
}

function toPersistedStepType(
  step: RecipeStep
): 'llm' | 'skill_call' | 'transform' | 'content_create' | 'export' {
  if (step.type === 'foreach') {
    return 'transform';
  }
  return step.type;
}

async function ensureRunSteps(runId: string, steps: RecipeStep[]) {
  await prisma.recipeRunStep.createMany({
    data: steps.map((s, index) => ({
      runId,
      index,
      type: toPersistedStepType(s),
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
  brandId: string;
  runId: string;
  mode: 'managed' | 'byok';
  inputTokens?: number | null;
  outputTokens?: number | null;
  model?: string | null;
}) {
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

  if (params.mode === 'managed' && estimatedUsd > 0) {
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

async function addSkillCallCost(params: {
  brandId: string;
  runId: string;
  skillId: string;
  mode: 'managed' | 'byok';
  provider: string;
  model?: string | null;
}) {
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

  if (params.mode === 'managed' && estimatedCredits > 0 && estimatedUsd > 0) {
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
}

async function execLlmStep(params: {
  runId: string;
  brandId: string;
  config: RecipeConfig;
  step: Extract<RecipeStep, { type: 'llm' }>;
  state: RunState;
  resolvedInput: unknown;
}): Promise<unknown> {
  const preset = params.config.model_preset;
  const structured = isStructuredOutputStep(params.step);
  const temperature =
    typeof preset?.temperature === 'number' ? preset.temperature : structured ? 0 : 0.7;

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

  const openai = await resolveOpenAIForSkill(params.brandId, 'text_generation');
  const model = preset?.model?.trim() || openai.defaultModel;

  const responseFormat = (() => {
    if (!structured) {
      return undefined;
    }
    const spec = (params.step as any).structured_output || null;
    if (!spec || typeof spec !== 'object') {
      return undefined;
    }

    const schema = (spec as any).schema;
    if (!schema) {
      return undefined;
    }

    const nameRaw = (spec as any).name;
    const name =
      typeof nameRaw === 'string' && nameRaw.trim().length > 0
        ? nameRaw.trim()
        : `recipe_${params.runId}_step_${String((params.step as any).name || 'output').replace(/\s+/g, '_')}`;
    const strict = typeof (spec as any).strict === 'boolean' ? (spec as any).strict : true;

    return {
      type: 'json_schema',
      json_schema: {
        name,
        strict,
        schema,
      },
    };
  })();

  const completion = await openai.client.chat.completions.create({
    model,
    temperature,
    messages: [{ role: 'user', content: prompt }],
    ...(responseFormat ? ({ response_format: responseFormat } as any) : {}),
  });

  const text = completion.choices?.[0]?.message?.content ?? '';

  const usage: any = (completion as any).usage || {};
  await addCost({
    brandId: params.brandId,
    runId: params.runId,
    mode: openai.mode,
    inputTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null,
    outputTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null,
    model,
  });

  if (responseFormat) {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Structured output was requested but the model did not return valid JSON');
    }
  }

  return text;
}

type ExecuteStepContext = {
  runId: string;
  runBrandId: string;
  runContentSeriesId: string | null;
  runInputJson: Record<string, unknown>;
  recipeTemplateId: string;
  recipeTemplateVersionId: string;
  recipeTemplateName: string;
  multiDestinationEnabled: boolean;
  config: RecipeConfig;
};

function resolveStepInput(step: RecipeStep, state: RunState): unknown {
  if (step.type === 'export') {
    return null;
  }
  if (step.type === 'foreach') {
    return interpolateUnknown((step as any).items, state);
  }
  return interpolateUnknown((step as any).input, state);
}

async function executeRuntimeStep(params: {
  ctx: ExecuteStepContext;
  step: RecipeStep;
  state: RunState;
  defaultOutputKey: string;
}): Promise<unknown> {
  const { ctx, step, state, defaultOutputKey } = params;
  const resolvedInput = resolveStepInput(step, state);

  if (step.type === 'transform') {
    const out = interpolateUnknown(step.input || {}, state);
    if (step.output_key) {
      state[step.output_key] = out as any;
      return out;
    }
    if (out && typeof out === 'object' && !Array.isArray(out)) {
      Object.assign(state, out as any);
      return out;
    }
    return out;
  }

  if (step.type === 'skill_call') {
    const res = await executeSkillCall({
      brandId: ctx.runBrandId,
      skillId: step.skill,
      input: resolvedInput,
    });
    await addSkillCallCost({
      brandId: ctx.runBrandId,
      runId: ctx.runId,
      skillId: step.skill,
      mode: res.mode,
      provider: res.provider,
      model: res.model || null,
    });
    const key = step.output_key || defaultOutputKey;
    state[key] = res.output as any;
    return res.output;
  }

  if (step.type === 'llm') {
    const llmOutput = await execLlmStep({
      runId: ctx.runId,
      brandId: ctx.runBrandId,
      config: ctx.config,
      step,
      state,
      resolvedInput,
    });
    const key = step.output_key || defaultOutputKey;
    state[key] = llmOutput as any;

    if (step.artifact) {
      const artifact = step.artifact;
      const resolved = artifact.content
        ? interpolateTemplateString(artifact.content, state)
        : llmOutput;
      const content = typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
      if (artifact.kind === 'asset') {
        await createArtifact({
          runId: ctx.runId,
          kind: 'asset',
          name: artifact.name,
          mimeType: artifact.mime_type || null,
          assetId: content || null,
        });
      } else {
        await createArtifact({
          runId: ctx.runId,
          kind: artifact.kind,
          name: artifact.name,
          mimeType: artifact.mime_type || null,
          contentText: content || '',
        });
      }
    }

    return llmOutput;
  }

  if (step.type === 'export') {
    for (const artifact of step.artifacts) {
      const content = artifact.content ? interpolateTemplateString(artifact.content, state) : '';
      if (artifact.kind === 'asset') {
        await createArtifact({
          runId: ctx.runId,
          kind: 'asset',
          name: artifact.name,
          mimeType: artifact.mime_type || null,
          assetId: content || null,
        });
      } else {
        await createArtifact({
          runId: ctx.runId,
          kind: artifact.kind,
          name: artifact.name,
          mimeType: artifact.mime_type || null,
          contentText: content,
        });
      }
    }
    return {
      artifacts: step.artifacts.map((a: (typeof step.artifacts)[number]) => ({
        kind: a.kind,
        name: a.name,
      })),
    };
  }

  if (step.type === 'content_create') {
    const input = resolvedInput && typeof resolvedInput === 'object' ? (resolvedInput as any) : {};
    const brandTimezone = await TimezoneService.getBrandTimezone(ctx.runBrandId);
    const defaultRollingConfig = {
      enabled: false,
      minQueueDays: 3,
      targetQueueDays: 7,
      maxQueueDays: 14,
      batchSize: 3,
    };

    const strategy = typeof input.strategy === 'string' ? input.strategy : 'after_last_scheduled';
    const postingTime =
      typeof input.posting_time === 'string' && /^\d{2}:\d{2}$/.test(input.posting_time)
        ? input.posting_time
        : '09:00';
    const maxPosts =
      typeof input.max_posts === 'number'
        ? Math.max(1, Math.floor(input.max_posts))
        : typeof input.max_posts === 'string'
          ? Math.max(1, Number.parseInt(input.max_posts, 10) || Number.NaN)
          : null;
    const existingSeriesId =
      typeof input.content_series_id === 'string' && input.content_series_id.trim().length > 0
        ? input.content_series_id.trim()
        : typeof input.contentSeriesId === 'string' && input.contentSeriesId.trim().length > 0
          ? input.contentSeriesId.trim()
          : ctx.runContentSeriesId && ctx.runContentSeriesId.trim().length > 0
            ? ctx.runContentSeriesId.trim()
            : null;

    let startDateYmd: string;
    if (strategy === 'start_date' && isYmd(input.start_date)) {
      startDateYmd = input.start_date.trim();
    } else {
      const nowUtc = now();
      const last = existingSeriesId
        ? await prisma.content.findFirst({
            where: {
              brandId: ctx.runBrandId,
              contentSeriesId: existingSeriesId,
              scheduledAt: { not: null },
            },
            orderBy: { scheduledAt: 'desc' },
            select: { scheduledAt: true },
          })
        : await prisma.content.findFirst({
            where: { brandId: ctx.runBrandId, scheduledAt: { gte: nowUtc } },
            orderBy: { scheduledAt: 'desc' },
            select: { scheduledAt: true },
          });

      const baseYmd = last?.scheduledAt
        ? formatInTimeZone(last.scheduledAt, brandTimezone, 'yyyy-MM-dd')
        : formatInTimeZone(nowUtc, brandTimezone, 'yyyy-MM-dd');
      startDateYmd = addDaysToYmd(baseYmd, 1);
    }

    const seriesName =
      typeof input.series_name === 'string' && input.series_name.trim().length
        ? input.series_name.trim()
        : `${ctx.recipeTemplateName} · ${formatInTimeZone(now(), brandTimezone, 'yyyy-MM-dd')}`;
    const seriesDescription =
      typeof input.series_description === 'string' && input.series_description.trim().length
        ? input.series_description.trim()
        : null;
    const seriesColor =
      typeof input.series_color === 'string' && input.series_color.trim().length
        ? input.series_color.trim()
        : null;

    const targetSocialAccountId =
      typeof input.target_social_account_id === 'string' &&
      input.target_social_account_id.trim().length > 0
        ? input.target_social_account_id.trim()
        : typeof input.targetSocialAccountId === 'string' &&
            input.targetSocialAccountId.trim().length > 0
          ? input.targetSocialAccountId.trim()
          : null;

    const postsCandidate = input.posts ?? input.posts_json ?? input.postsJson ?? null;
    const parsedPosts: any[] = parsePostsJsonCandidate(postsCandidate);
    const posts = Number.isFinite(maxPosts as number)
      ? parsedPosts.slice(0, maxPosts as number)
      : parsedPosts;

    if (!posts.length) {
      throw new Error('content_create requires posts (array) or posts_json (JSON array string)');
    }

    const result = await prisma.$transaction(async (tx) => {
      if (targetSocialAccountId) {
        const destination = await tx.socialAccount.findFirst({
          where: {
            id: targetSocialAccountId,
            brandId: ctx.runBrandId,
          },
          select: { id: true, platform: true },
        });
        if (!destination) {
          throw new Error('target_social_account_id is invalid for this brand');
        }
        if (
          !ctx.multiDestinationEnabled &&
          String(destination.platform || '')
            .trim()
            .toLowerCase() !== 'instagram'
        ) {
          throw new Error('Only Instagram destinations are enabled for this account');
        }
      }

      const series = existingSeriesId
        ? await tx.contentSeries.findFirst({
            where: { id: existingSeriesId, brandId: ctx.runBrandId },
            select: { id: true, name: true },
          })
        : await tx.contentSeries.create({
            data: {
              brandId: ctx.runBrandId,
              name: seriesName,
              description: seriesDescription,
              color: seriesColor,
              kind: 'batch',
              status: 'active',
              generatorJson: {
                source: 'recipe',
                recipeTemplateId: ctx.recipeTemplateId,
                recipeTemplateVersionId: ctx.recipeTemplateVersionId,
                inputJson: ctx.runInputJson as any,
                createdFromRunId: ctx.runId,
              } as any,
              rollingConfigJson: defaultRollingConfig as any,
            },
            select: { id: true, name: true },
          });

      if (!series) {
        throw new Error('content_create could not resolve target content series');
      }

      await tx.recipeRun.update({
        where: { id: ctx.runId },
        data: { contentSeriesId: series.id },
        select: { id: true },
      });

      const contentIds: string[] = [];
      const skippedScheduleDates: string[] = [];
      for (let i = 0; i < posts.length; i++) {
        const p = posts[i] && typeof posts[i] === 'object' ? (posts[i] as any) : {};
        const caption = typeof p.caption === 'string' ? p.caption : '';
        if (!caption.trim()) {
          continue;
        }

        const hashtags =
          Array.isArray(p.hashtags) && p.hashtags.every((h: any) => typeof h === 'string')
            ? (p.hashtags as string[])
                .map((h) => String(h).replace(/^#/, '').trim())
                .filter(Boolean)
            : extractHashtagsFromCaption(caption);

        const ymd = addDaysToYmd(startDateYmd, i);
        const scheduledAt = TimezoneService.createDateInBrandTimezone(
          ymd,
          postingTime,
          brandTimezone
        );
        const duplicateAtTime = await tx.content.findFirst({
          where: { contentSeriesId: series.id, scheduledAt },
          select: { id: true },
        });
        if (duplicateAtTime) {
          skippedScheduleDates.push(scheduledAt.toISOString());
          continue;
        }

        const created = await tx.content.create({
          data: {
            brandId: ctx.runBrandId,
            contentSeriesId: series.id,
            recipeRunId: ctx.runId,
            ...(targetSocialAccountId ? { targetSocialAccountId } : {}),
            caption: caption.trim(),
            hashtags,
            status: 'draft',
            scheduledAt,
            generationParams: {
              source: 'recipe_run',
              runId: ctx.runId,
              recipeTemplateId: ctx.recipeTemplateId,
              recipeTemplateVersionId: ctx.recipeTemplateVersionId,
            },
          },
          select: { id: true },
        });
        contentIds.push(created.id);

        const assetIdsCandidate =
          (Array.isArray(p.asset_ids) ? p.asset_ids : null) ??
          (Array.isArray(p.assetIds) ? p.assetIds : null) ??
          (typeof p.asset_id === 'string' ? [p.asset_id] : null) ??
          (typeof p.assetId === 'string' ? [p.assetId] : null);
        const assetIds = Array.isArray(assetIdsCandidate)
          ? assetIdsCandidate
              .filter((id: any) => typeof id === 'string')
              .map((id: string) => id.trim())
              .filter(Boolean)
          : [];

        if (assetIds.length > 0) {
          await tx.contentMediaAsset.createMany({
            data: assetIds.map((assetId, idx) => ({
              contentId: created.id,
              displayOrder: idx,
              assetId,
            })),
            skipDuplicates: true,
          });
        }
      }

      return {
        contentSeriesId: series.id,
        contentSeriesName: series.name,
        contentIds,
        skippedScheduleDates,
      };
    });

    const createdJson = JSON.stringify(
      {
        contentSeriesId: result.contentSeriesId,
        contentIds: result.contentIds,
        skippedScheduleDates: result.skippedScheduleDates,
      },
      null,
      2
    );

    await createArtifact({
      runId: ctx.runId,
      kind: 'json',
      name: 'created_content.json',
      mimeType: 'application/json',
      contentText: createdJson,
    });

    const key = step.output_key || defaultOutputKey;
    state[key] = createdJson;
    return {
      ...result,
      createdCount: result.contentIds.length,
      skippedCount: result.skippedScheduleDates.length,
    };
  }

  if (step.type === 'foreach') {
    const rawItems = resolvedInput;
    const items = Array.isArray(rawItems) ? rawItems : parseJsonArrayCandidate(rawItems);
    if (!Array.isArray(rawItems) && items.length === 0) {
      throw new Error('foreach requires items to resolve to an array');
    }

    const itemKey = step.item_key?.trim() || 'item';
    const indexKey = step.index_key?.trim() || 'item_index';
    const hadPrevItem = Object.prototype.hasOwnProperty.call(state, itemKey);
    const hadPrevIndex = Object.prototype.hasOwnProperty.call(state, indexKey);
    const prevItem = state[itemKey];
    const prevIndex = state[indexKey];
    const iterationOutputs: Array<Record<string, unknown>> = [];

    try {
      for (let i = 0; i < items.length; i++) {
        state[itemKey] = items[i] as any;
        state[indexKey] = i;

        const iterOutput: Record<string, unknown> = { index: i };

        for (let childIndex = 0; childIndex < step.do.length; childIndex++) {
          const childStep = step.do[childIndex] as RecipeStep;
          if (!evalWhen(childStep.when, state)) {
            continue;
          }

          const childOutput = await executeRuntimeStep({
            ctx,
            step: childStep,
            state,
            defaultOutputKey: `${defaultOutputKey}_i${i}_s${childIndex}`,
          });

          const childOutputKey = (childStep as any).output_key as string | undefined;
          if (typeof childOutputKey === 'string' && childOutputKey.trim().length > 0) {
            iterOutput[childOutputKey.trim()] = state[childOutputKey.trim()];
          } else {
            iterOutput[`step_${childIndex}`] = childOutput;
          }
        }

        iterationOutputs.push(iterOutput);
      }
    } finally {
      if (hadPrevItem) {
        state[itemKey] = prevItem;
      } else {
        delete state[itemKey];
      }
      if (hadPrevIndex) {
        state[indexKey] = prevIndex;
      } else {
        delete state[indexKey];
      }
    }

    if (step.output_key) {
      state[step.output_key] = iterationOutputs as any;
    }

    return { iterations: items.length };
  }

  return null;
}

export async function executeRecipeRun(runId: string): Promise<{ runId: string; status: string }> {
  const run = await prisma.recipeRun.findUnique({
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

  const multiDestinationEnabled = isMultiDestinationEnabledForUser({
    userId: run.createdByUserId ?? null,
    email: run.createdByUser?.email ?? null,
  });

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

      const resolvedInput = resolveStepInput(step, state);

      await updateStep({
        runId,
        index,
        data: {
          status: 'running',
          startedAt: now(),
          inputJsonRedacted: redactSensitive(resolvedInput),
        },
      });

      const output = await executeRuntimeStep({
        ctx: {
          runId,
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
        },
        step,
        state,
        defaultOutputKey: `step_${index}_output`,
      });

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
