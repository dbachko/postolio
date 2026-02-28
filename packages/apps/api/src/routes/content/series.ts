/**
 * Content Series Routes
 * Series are used to group a set of posts over time (ex: recipe runs, rolling pipelines).
 *
 * Note: This is distinct from ContentGroup, which represents multi-destination variants of a single post.
 */

import type { FastifyPluginAsync } from 'fastify';

import { getDatabaseClient } from '../../config/database.js';
import {
  contentSeriesRollingService,
  normalizeSeriesRollingConfig,
} from '../../services/content-series-rolling.js';
import { assertBrandOwnership } from '../../services/ownership.js';

const prisma = getDatabaseClient();

function parseContentSeriesId(contentSeriesId: unknown) {
  return typeof contentSeriesId === 'string' && contentSeriesId ? contentSeriesId : null;
}

async function loadAuthorizedSeries(params: {
  contentSeriesId: string;
  userId: string;
  reply: any;
  select: Record<string, unknown>;
}) {
  const series = await prisma.contentSeries.findUnique({
    where: { id: params.contentSeriesId },
    select: params.select as any,
  });
  if (!(series as any)?.brand) {
    params.reply.code(404).send({ error: 'content_series_not_found' });
    return null;
  }
  if ((series as any).brand.userId !== params.userId) {
    params.reply.code(404).send({ error: 'content_series_not_found' });
    return null;
  }

  await assertBrandOwnership(params.userId, (series as any).brandId);
  return series;
}

function mapGeneration(g: any) {
  return {
    id: g.id,
    status: g.status,
    trigger: g.trigger,
    createdAt: g.createdAt,
    startedAt: g.startedAt,
    finishedAt: g.finishedAt,
    errorMessage: g.errorMessage,
    recipe: g.recipeTemplate
      ? {
          id: g.recipeTemplate.id,
          slug: g.recipeTemplate.slug,
          name: g.recipeTemplate.name,
          category: g.recipeTemplate.category,
          version: g.recipeTemplateVersion?.version ?? null,
        }
      : null,
  };
}

function mapSeriesContent(item: any) {
  return {
    id: item.id,
    caption: item.caption,
    hashtags: item.hashtags,
    status: item.status,
    scheduledAt: item.scheduledAt,
    postedAt: item.postedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    brandId: item.brandId,
    contentGroupId: item.contentGroupId,
    contentSeriesId: item.contentSeriesId,
    targetSocialAccountId: item.targetSocialAccountId,
    recipeRunId: item.recipeRunId,
    generatedByRecipe: item.recipeRun?.recipeTemplate ?? null,
    schedulingError: item.schedulingError,
    generationParams: item.generationParams,
    contentType: item.contentType,
    shareToFeed: item.shareToFeed,
    thumbOffset: item.thumbOffset,
    firstComment: item.firstComment,
    firstCommentStatus: item.firstCommentStatus,
    firstCommentPostedAt: item.firstCommentPostedAt,
    firstCommentError: item.firstCommentError,
    publishingQueueItemId: item.publishingQueueItem?.id ?? null,
    primaryAssetId: item.mediaAssets?.[0]?.assetId ?? null,
    mediaAssets: item.mediaAssets,
    mediaAssetCount: item._count?.mediaAssets ?? null,
  };
}

async function loadSeriesDetails(contentSeriesId: string) {
  const [contents, generations] = await Promise.all([
    prisma.content.findMany({
      where: { contentSeriesId },
      select: {
        id: true,
        caption: true,
        hashtags: true,
        status: true,
        scheduledAt: true,
        postedAt: true,
        createdAt: true,
        updatedAt: true,
        brandId: true,
        contentGroupId: true,
        contentSeriesId: true,
        targetSocialAccountId: true,
        recipeRunId: true,
        recipeRun: { select: { recipeTemplate: { select: { id: true, slug: true, name: true } } } },
        schedulingError: true,
        generationParams: true,
        contentType: true,
        shareToFeed: true,
        thumbOffset: true,
        firstComment: true,
        firstCommentStatus: true,
        firstCommentPostedAt: true,
        firstCommentError: true,
        publishingQueueItem: { select: { id: true } },
        mediaAssets: {
          select: { assetId: true, displayOrder: true },
          orderBy: { displayOrder: 'asc' },
        },
        _count: { select: { mediaAssets: true } },
      },
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.recipeRun.findMany({
      where: { contentSeriesId },
      select: {
        id: true,
        status: true,
        trigger: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
        errorMessage: true,
        recipeTemplate: { select: { id: true, slug: true, name: true, category: true } },
        recipeTemplateVersion: { select: { version: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);
  return { contents, generations };
}

function buildSeriesDetailsResponse(series: any, contents: any[], generations: any[]) {
  return {
    success: true,
    data: {
      contentSeries: {
        id: series.id,
        brandId: series.brandId,
        key: series.key,
        name: series.name,
        description: series.description,
        color: series.color,
        kind: series.kind,
        status: series.status,
        generatorJson: series.generatorJson,
        rollingConfigJson: series.rollingConfigJson,
        createdAt: series.createdAt,
        updatedAt: series.updatedAt,
      },
      generations: generations.map(mapGeneration),
      contents: contents.map(mapSeriesContent),
    },
  };
}

function parseSeriesPatchPayload(body: any, rollingConfigJson: unknown) {
  const nextName = typeof body?.name === 'string' ? body.name.trim() : undefined;
  if (nextName?.length === 0) {
    return { error: 'invalid_name' } as const;
  }

  const nextDescription =
    body?.description === null
      ? null
      : typeof body?.description === 'string'
        ? body.description.trim()
        : undefined;
  const nextColor =
    body?.color === null ? null : typeof body?.color === 'string' ? body.color.trim() : undefined;
  const nextStatus =
    body?.status === 'active' || body?.status === 'paused' || body?.status === 'archived'
      ? body.status
      : undefined;
  const rollingPartial =
    body?.rolling && typeof body.rolling === 'object' ? body.rolling : undefined;
  const mergedRolling =
    rollingPartial !== undefined
      ? normalizeSeriesRollingConfig({
          ...(rollingConfigJson as Record<string, unknown>),
          ...rollingPartial,
        })
      : undefined;

  return {
    nextName,
    nextDescription,
    nextColor,
    nextStatus,
    mergedRolling,
  };
}

async function createGetSeriesHandler(request: any, reply: any) {
  const contentSeriesId = parseContentSeriesId(request.params?.contentSeriesId);
  if (!contentSeriesId) {
    return reply.code(400).send({ error: 'invalid_content_series_id' });
  }

  const series = await loadAuthorizedSeries({
    contentSeriesId,
    userId: request.user!.id,
    reply,
    select: {
      id: true,
      brandId: true,
      key: true,
      name: true,
      description: true,
      color: true,
      kind: true,
      status: true,
      generatorJson: true,
      rollingConfigJson: true,
      createdAt: true,
      updatedAt: true,
      brand: { select: { id: true, userId: true } },
    },
  });
  if (!series) {
    return;
  }

  const { contents, generations } = await loadSeriesDetails((series as any).id);
  return reply.send(buildSeriesDetailsResponse(series, contents, generations));
}

function createPatchSeriesHandler() {
  return async (request: any, reply: any) => {
    const contentSeriesId = parseContentSeriesId(request.params?.contentSeriesId);
    if (!contentSeriesId) {
      return reply.code(400).send({ error: 'invalid_content_series_id' });
    }

    const series = await loadAuthorizedSeries({
      contentSeriesId,
      userId: request.user!.id,
      reply,
      select: {
        id: true,
        brandId: true,
        rollingConfigJson: true,
        brand: { select: { userId: true } },
      },
    });
    if (!series) {
      return;
    }

    const patchPayload = parseSeriesPatchPayload(request.body, (series as any).rollingConfigJson);
    if ('error' in patchPayload) {
      return reply.code(400).send({ error: patchPayload.error });
    }

    const updated = await prisma.contentSeries.update({
      where: { id: contentSeriesId },
      data: {
        ...(patchPayload.nextName !== undefined ? { name: patchPayload.nextName } : {}),
        ...(patchPayload.nextDescription !== undefined
          ? { description: patchPayload.nextDescription }
          : {}),
        ...(patchPayload.nextColor !== undefined ? { color: patchPayload.nextColor } : {}),
        ...(patchPayload.nextStatus !== undefined ? { status: patchPayload.nextStatus } : {}),
        ...(patchPayload.mergedRolling !== undefined
          ? { rollingConfigJson: patchPayload.mergedRolling as any }
          : {}),
        ...(patchPayload.mergedRolling?.enabled ? { kind: 'rolling' } : {}),
      },
      select: {
        id: true,
        brandId: true,
        key: true,
        name: true,
        description: true,
        color: true,
        kind: true,
        status: true,
        generatorJson: true,
        rollingConfigJson: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return reply.send({ success: true, data: { contentSeries: updated } });
  };
}

function createGetRollingStatusHandler() {
  return async (request: any, reply: any) => {
    const contentSeriesId = parseContentSeriesId(request.params?.contentSeriesId);
    if (!contentSeriesId) {
      return reply.code(400).send({ error: 'invalid_content_series_id' });
    }

    const series = await loadAuthorizedSeries({
      contentSeriesId,
      userId: request.user!.id,
      reply,
      select: { id: true, brandId: true, brand: { select: { userId: true } } },
    });
    if (!series) {
      return;
    }

    const status = await contentSeriesRollingService.getStatus(contentSeriesId);
    if (!status) {
      return reply.code(404).send({ error: 'content_series_not_found' });
    }
    return reply.send({ success: true, data: { rolling: status } });
  };
}

function createRefreshRollingHandler() {
  return async (request: any, reply: any) => {
    const contentSeriesId = parseContentSeriesId(request.params?.contentSeriesId);
    if (!contentSeriesId) {
      return reply.code(400).send({ error: 'invalid_content_series_id' });
    }

    const series = await loadAuthorizedSeries({
      contentSeriesId,
      userId: request.user!.id,
      reply,
      select: { id: true, brandId: true, brand: { select: { userId: true } } },
    });
    if (!series) {
      return;
    }

    const result = await contentSeriesRollingService.refresh(contentSeriesId);
    return reply.send({ success: true, data: { rollingRefresh: result } });
  };
}

const seriesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { contentSeriesId: string } }>(
    '/series/:contentSeriesId',
    { preHandler: fastify.authenticate },
    createGetSeriesHandler
  );

  fastify.patch<{
    Params: { contentSeriesId: string };
    Body: {
      name?: string;
      description?: string | null;
      color?: string | null;
      status?: 'active' | 'paused' | 'archived';
      rolling?: {
        enabled?: boolean;
        minQueueDays?: number;
        targetQueueDays?: number;
        maxQueueDays?: number;
        batchSize?: number;
      };
    };
  }>('/series/:contentSeriesId', { preHandler: fastify.authenticate }, createPatchSeriesHandler());

  fastify.get<{ Params: { contentSeriesId: string } }>(
    '/series/:contentSeriesId/rolling/status',
    { preHandler: fastify.authenticate },
    createGetRollingStatusHandler()
  );

  fastify.post<{ Params: { contentSeriesId: string } }>(
    '/series/:contentSeriesId/rolling/refresh',
    { preHandler: fastify.authenticate },
    createRefreshRollingHandler()
  );
};

export default seriesRoutes;
