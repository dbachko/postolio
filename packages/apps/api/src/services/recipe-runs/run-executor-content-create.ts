import type { Prisma } from '@postolio/database';
import { formatInTimeZone } from 'date-fns-tz';
import { prisma } from '../../config/database.js';
import { TimezoneService } from '../timezone.js';
import type { RecipeStep } from '../recipes/config-schema.js';
import type { ExecuteStepContext, RunState } from './run-executor-types.js';
import {
  addDaysToYmd,
  extractHashtagsFromCaption,
  isYmd,
  now,
  parsePostsJsonCandidate,
} from './run-executor-shared.js';
import { createRunArtifact } from './run-executor-persistence.js';

type ContentCreateStep = Extract<RecipeStep, { type: 'content_create' }>;
type ContentCreateInput = Record<string, unknown>;

const DEFAULT_ROLLING_CONFIG = {
  enabled: false,
  minQueueDays: 3,
  targetQueueDays: 7,
  maxQueueDays: 14,
  batchSize: 3,
};

function parsePostingTime(value: unknown): string {
  if (typeof value === 'string' && /^\d{2}:\d{2}$/.test(value)) {
    return value;
  }
  return '09:00';
}

function parseMaxPosts(value: unknown): number | null {
  if (typeof value === 'number') {
    return Math.max(1, Math.floor(value));
  }
  if (typeof value === 'string') {
    return Math.max(1, Number.parseInt(value, 10) || Number.NaN);
  }
  return null;
}

function resolveExistingSeriesId(
  input: ContentCreateInput,
  fallback: string | null
): string | null {
  const candidates = [input.content_series_id, input.contentSeriesId, fallback];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function resolveTargetSocialAccountId(input: ContentCreateInput): string | null {
  const candidates = [input.target_social_account_id, input.targetSocialAccountId];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

async function resolveStartDateYmd(params: {
  strategy: string;
  input: ContentCreateInput;
  existingSeriesId: string | null;
  brandId: string;
  brandTimezone: string;
}): Promise<string> {
  if (params.strategy === 'start_date' && isYmd(params.input.start_date)) {
    return params.input.start_date.trim();
  }

  const nowUtc = now();
  const lastScheduled = params.existingSeriesId
    ? await prisma.content.findFirst({
        where: {
          brandId: params.brandId,
          contentSeriesId: params.existingSeriesId,
          scheduledAt: { not: null },
        },
        orderBy: { scheduledAt: 'desc' },
        select: { scheduledAt: true },
      })
    : await prisma.content.findFirst({
        where: { brandId: params.brandId, scheduledAt: { gte: nowUtc } },
        orderBy: { scheduledAt: 'desc' },
        select: { scheduledAt: true },
      });

  const baseYmd = lastScheduled?.scheduledAt
    ? formatInTimeZone(lastScheduled.scheduledAt, params.brandTimezone, 'yyyy-MM-dd')
    : formatInTimeZone(nowUtc, params.brandTimezone, 'yyyy-MM-dd');
  return addDaysToYmd(baseYmd, 1);
}

function resolveSeriesName(
  input: ContentCreateInput,
  recipeTemplateName: string,
  brandTimezone: string
): string {
  if (typeof input.series_name === 'string' && input.series_name.trim().length > 0) {
    return input.series_name.trim();
  }

  return `${recipeTemplateName} · ${formatInTimeZone(now(), brandTimezone, 'yyyy-MM-dd')}`;
}

function resolveSeriesDescription(input: ContentCreateInput): string | null {
  if (typeof input.series_description === 'string' && input.series_description.trim().length > 0) {
    return input.series_description.trim();
  }
  return null;
}

function resolveSeriesColor(input: ContentCreateInput): string | null {
  if (typeof input.series_color === 'string' && input.series_color.trim().length > 0) {
    return input.series_color.trim();
  }
  return null;
}

function resolvePosts(input: ContentCreateInput, maxPosts: number | null): any[] {
  const postsCandidate = input.posts ?? input.posts_json ?? input.postsJson ?? null;
  const parsedPosts = parsePostsJsonCandidate(postsCandidate);
  return Number.isFinite(maxPosts as number)
    ? parsedPosts.slice(0, maxPosts as number)
    : parsedPosts;
}

function normalizeHashtags(post: Record<string, unknown>, caption: string): string[] {
  if (Array.isArray(post.hashtags) && post.hashtags.every((value) => typeof value === 'string')) {
    return (post.hashtags as string[])
      .map((tag) => String(tag).replace(/^#/, '').trim())
      .filter(Boolean);
  }

  return extractHashtagsFromCaption(caption);
}

function resolveAssetIds(post: Record<string, unknown>): string[] {
  const candidate =
    (Array.isArray(post.asset_ids) ? post.asset_ids : null) ??
    (Array.isArray(post.assetIds) ? post.assetIds : null) ??
    (typeof post.asset_id === 'string' ? [post.asset_id] : null) ??
    (typeof post.assetId === 'string' ? [post.assetId] : null);

  if (!Array.isArray(candidate)) {
    return [];
  }

  return candidate
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
}

async function validateTargetSocialAccount(
  tx: Prisma.TransactionClient,
  params: { targetSocialAccountId: string; brandId: string; multiDestinationEnabled: boolean }
): Promise<void> {
  const destination = await tx.socialAccount.findFirst({
    where: {
      id: params.targetSocialAccountId,
      brandId: params.brandId,
    },
    select: { id: true, platform: true },
  });

  if (!destination) {
    throw new Error('target_social_account_id is invalid for this brand');
  }

  if (
    !params.multiDestinationEnabled &&
    String(destination.platform || '')
      .trim()
      .toLowerCase() !== 'instagram'
  ) {
    throw new Error('Only Instagram destinations are enabled for this account');
  }
}

async function resolveSeriesForCreation(
  tx: Prisma.TransactionClient,
  params: {
    ctx: ExecuteStepContext;
    existingSeriesId: string | null;
    seriesName: string;
    seriesDescription: string | null;
    seriesColor: string | null;
  }
): Promise<{ id: string; name: string }> {
  if (params.existingSeriesId) {
    const existing = await tx.contentSeries.findFirst({
      where: { id: params.existingSeriesId, brandId: params.ctx.runBrandId },
      select: { id: true, name: true },
    });
    if (existing) {
      return existing;
    }
  }

  return tx.contentSeries.create({
    data: {
      brandId: params.ctx.runBrandId,
      name: params.seriesName,
      description: params.seriesDescription,
      color: params.seriesColor,
      kind: 'batch',
      status: 'active',
      generatorJson: {
        source: 'recipe',
        recipeTemplateId: params.ctx.recipeTemplateId,
        recipeTemplateVersionId: params.ctx.recipeTemplateVersionId,
        inputJson: params.ctx.runInputJson as any,
        createdFromRunId: params.ctx.runId,
      } as any,
      rollingConfigJson: DEFAULT_ROLLING_CONFIG as any,
    },
    select: { id: true, name: true },
  });
}

async function createContentRows(params: {
  tx: Prisma.TransactionClient;
  ctx: ExecuteStepContext;
  seriesId: string;
  posts: any[];
  startDateYmd: string;
  postingTime: string;
  brandTimezone: string;
  targetSocialAccountId: string | null;
}) {
  const contentIds: string[] = [];
  const skippedScheduleDates: string[] = [];

  for (let i = 0; i < params.posts.length; i++) {
    const post =
      params.posts[i] && typeof params.posts[i] === 'object' ? (params.posts[i] as any) : {};
    const caption = typeof post.caption === 'string' ? post.caption : '';
    if (!caption.trim()) {
      continue;
    }

    const scheduledYmd = addDaysToYmd(params.startDateYmd, i);
    const scheduledAt = TimezoneService.createDateInBrandTimezone(
      scheduledYmd,
      params.postingTime,
      params.brandTimezone
    );
    const duplicateAtTime = await params.tx.content.findFirst({
      where: { contentSeriesId: params.seriesId, scheduledAt },
      select: { id: true },
    });
    if (duplicateAtTime) {
      skippedScheduleDates.push(scheduledAt.toISOString());
      continue;
    }

    const created = await params.tx.content.create({
      data: {
        brandId: params.ctx.runBrandId,
        contentSeriesId: params.seriesId,
        recipeRunId: params.ctx.runId,
        ...(params.targetSocialAccountId
          ? { targetSocialAccountId: params.targetSocialAccountId }
          : {}),
        caption: caption.trim(),
        hashtags: normalizeHashtags(post, caption),
        status: 'draft',
        scheduledAt,
        generationParams: {
          source: 'recipe_run',
          runId: params.ctx.runId,
          recipeTemplateId: params.ctx.recipeTemplateId,
          recipeTemplateVersionId: params.ctx.recipeTemplateVersionId,
        },
      },
      select: { id: true },
    });
    contentIds.push(created.id);

    const assetIds = resolveAssetIds(post);
    if (assetIds.length > 0) {
      await params.tx.contentMediaAsset.createMany({
        data: assetIds.map((assetId, idx) => ({
          contentId: created.id,
          displayOrder: idx,
          assetId,
        })),
        skipDuplicates: true,
      });
    }
  }

  return { contentIds, skippedScheduleDates };
}

function toContentCreateInput(resolvedInput: unknown): ContentCreateInput {
  if (!resolvedInput || typeof resolvedInput !== 'object') {
    return {};
  }
  return resolvedInput as ContentCreateInput;
}

function buildCreatedContentArtifact(result: {
  contentSeriesId: string;
  contentIds: string[];
  skippedScheduleDates: string[];
}): string {
  return JSON.stringify(
    {
      contentSeriesId: result.contentSeriesId,
      contentIds: result.contentIds,
      skippedScheduleDates: result.skippedScheduleDates,
    },
    null,
    2
  );
}

export async function executeContentCreateStep(params: {
  ctx: ExecuteStepContext;
  step: ContentCreateStep;
  state: RunState;
  defaultOutputKey: string;
  resolvedInput: unknown;
}): Promise<unknown> {
  const input = toContentCreateInput(params.resolvedInput);
  const brandTimezone = await TimezoneService.getBrandTimezone(params.ctx.runBrandId);
  const strategy = typeof input.strategy === 'string' ? input.strategy : 'after_last_scheduled';
  const postingTime = parsePostingTime(input.posting_time);
  const maxPosts = parseMaxPosts(input.max_posts);
  const existingSeriesId = resolveExistingSeriesId(input, params.ctx.runContentSeriesId);
  const targetSocialAccountId = resolveTargetSocialAccountId(input);
  const startDateYmd = await resolveStartDateYmd({
    strategy,
    input,
    existingSeriesId,
    brandId: params.ctx.runBrandId,
    brandTimezone,
  });
  const posts = resolvePosts(input, maxPosts);
  if (!posts.length) {
    throw new Error('content_create requires posts (array) or posts_json (JSON array string)');
  }

  const result = await prisma.$transaction(async (tx) => {
    if (targetSocialAccountId) {
      await validateTargetSocialAccount(tx, {
        targetSocialAccountId,
        brandId: params.ctx.runBrandId,
        multiDestinationEnabled: params.ctx.multiDestinationEnabled,
      });
    }

    const series = await resolveSeriesForCreation(tx, {
      ctx: params.ctx,
      existingSeriesId,
      seriesName: resolveSeriesName(input, params.ctx.recipeTemplateName, brandTimezone),
      seriesDescription: resolveSeriesDescription(input),
      seriesColor: resolveSeriesColor(input),
    });

    await tx.recipeRun.update({
      where: { id: params.ctx.runId },
      data: { contentSeriesId: series.id },
      select: { id: true },
    });

    const createdRows = await createContentRows({
      tx,
      ctx: params.ctx,
      seriesId: series.id,
      posts,
      startDateYmd,
      postingTime,
      brandTimezone,
      targetSocialAccountId,
    });

    return {
      contentSeriesId: series.id,
      contentSeriesName: series.name,
      contentIds: createdRows.contentIds,
      skippedScheduleDates: createdRows.skippedScheduleDates,
    };
  });

  const createdJson = buildCreatedContentArtifact(result);
  await createRunArtifact({
    runId: params.ctx.runId,
    kind: 'json',
    name: 'created_content.json',
    mimeType: 'application/json',
    contentText: createdJson,
  });

  const key = params.step.output_key || params.defaultOutputKey;
  params.state[key] = createdJson;
  return {
    ...result,
    createdCount: result.contentIds.length,
    skippedCount: result.skippedScheduleDates.length,
  };
}
