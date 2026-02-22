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

const seriesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/content/series/:contentSeriesId
  fastify.get<{ Params: { contentSeriesId: string } }>(
    '/series/:contentSeriesId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { contentSeriesId } = request.params;

      if (!contentSeriesId || typeof contentSeriesId !== 'string') {
        return reply.code(400).send({ error: 'invalid_content_series_id' });
      }

      const series = await prisma.contentSeries.findUnique({
        where: { id: contentSeriesId },
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

      if (!series?.brand) {
        return reply.code(404).send({ error: 'content_series_not_found' });
      }
      if (series.brand.userId !== userId) {
        // Avoid leaking series existence across users.
        return reply.code(404).send({ error: 'content_series_not_found' });
      }

      await assertBrandOwnership(userId, series.brandId);

      const contents = await prisma.content.findMany({
        where: { contentSeriesId: series.id },
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
          recipeRun: {
            select: {
              recipeTemplate: { select: { id: true, slug: true, name: true } },
            },
          },
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
      });

      const generations = await prisma.recipeRun.findMany({
        where: { contentSeriesId: series.id },
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
      });

      return reply.send({
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
          generations: generations.map((g) => ({
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
          })),
          contents: contents.map((item) => ({
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
          })),
        },
      });
    }
  );

  // PATCH /api/content/series/:contentSeriesId
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
  }>('/series/:contentSeriesId', { preHandler: fastify.authenticate }, async (request, reply) => {
    const userId = request.user!.id;
    const { contentSeriesId } = request.params;

    if (!contentSeriesId || typeof contentSeriesId !== 'string') {
      return reply.code(400).send({ error: 'invalid_content_series_id' });
    }

    const series = await prisma.contentSeries.findUnique({
      where: { id: contentSeriesId },
      select: {
        id: true,
        brandId: true,
        rollingConfigJson: true,
        brand: { select: { userId: true } },
      },
    });
    if (!series?.brand) {
      return reply.code(404).send({ error: 'content_series_not_found' });
    }
    if (series.brand.userId !== userId) {
      return reply.code(404).send({ error: 'content_series_not_found' });
    }

    await assertBrandOwnership(userId, series.brandId);

    const nextName = typeof request.body?.name === 'string' ? request.body.name.trim() : undefined;
    const nextDescription =
      request.body?.description === null
        ? null
        : typeof request.body?.description === 'string'
          ? request.body.description.trim()
          : undefined;
    const nextColor =
      request.body?.color === null
        ? null
        : typeof request.body?.color === 'string'
          ? request.body.color.trim()
          : undefined;
    const nextStatus =
      request.body?.status === 'active' ||
      request.body?.status === 'paused' ||
      request.body?.status === 'archived'
        ? request.body.status
        : undefined;
    const nextRollingPartial =
      request.body?.rolling && typeof request.body.rolling === 'object'
        ? request.body.rolling
        : undefined;

    if (nextName?.length === 0) {
      return reply.code(400).send({ error: 'invalid_name' });
    }

    const mergedRolling =
      nextRollingPartial !== undefined
        ? normalizeSeriesRollingConfig({
            ...(series as any).rollingConfigJson,
            ...nextRollingPartial,
          })
        : undefined;

    const updated = await prisma.contentSeries.update({
      where: { id: contentSeriesId },
      data: {
        ...(nextName !== undefined ? { name: nextName } : {}),
        ...(nextDescription !== undefined ? { description: nextDescription } : {}),
        ...(nextColor !== undefined ? { color: nextColor } : {}),
        ...(nextStatus !== undefined ? { status: nextStatus } : {}),
        ...(mergedRolling !== undefined ? { rollingConfigJson: mergedRolling as any } : {}),
        ...(mergedRolling?.enabled ? { kind: 'rolling' } : {}),
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
  });

  // GET /api/content/series/:contentSeriesId/rolling/status
  fastify.get<{ Params: { contentSeriesId: string } }>(
    '/series/:contentSeriesId/rolling/status',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { contentSeriesId } = request.params;

      if (!contentSeriesId || typeof contentSeriesId !== 'string') {
        return reply.code(400).send({ error: 'invalid_content_series_id' });
      }

      const series = await prisma.contentSeries.findUnique({
        where: { id: contentSeriesId },
        select: { id: true, brandId: true, brand: { select: { userId: true } } },
      });
      if (!series?.brand) {
        return reply.code(404).send({ error: 'content_series_not_found' });
      }
      if (series.brand.userId !== userId) {
        return reply.code(404).send({ error: 'content_series_not_found' });
      }

      await assertBrandOwnership(userId, series.brandId);

      const status = await contentSeriesRollingService.getStatus(contentSeriesId);
      if (!status) {
        return reply.code(404).send({ error: 'content_series_not_found' });
      }
      return reply.send({ success: true, data: { rolling: status } });
    }
  );

  // POST /api/content/series/:contentSeriesId/rolling/refresh
  fastify.post<{ Params: { contentSeriesId: string } }>(
    '/series/:contentSeriesId/rolling/refresh',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { contentSeriesId } = request.params;

      if (!contentSeriesId || typeof contentSeriesId !== 'string') {
        return reply.code(400).send({ error: 'invalid_content_series_id' });
      }

      const series = await prisma.contentSeries.findUnique({
        where: { id: contentSeriesId },
        select: { id: true, brandId: true, brand: { select: { userId: true } } },
      });
      if (!series?.brand) {
        return reply.code(404).send({ error: 'content_series_not_found' });
      }
      if (series.brand.userId !== userId) {
        return reply.code(404).send({ error: 'content_series_not_found' });
      }

      await assertBrandOwnership(userId, series.brandId);

      const result = await contentSeriesRollingService.refresh(contentSeriesId);
      return reply.send({ success: true, data: { rollingRefresh: result } });
    }
  );
};

export default seriesRoutes;
