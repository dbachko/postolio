import type { FastifyInstance } from 'fastify';

import { buildContentListResponse } from '../../../services/content-response-builder.js';
import { verifyBrandOwnership } from '../../../services/content-operations/authorization.js';
import { prisma, type AuthenticatedRequest } from './shared.js';

async function getPendingContentResponse(userId: string, brandId: string) {
  const authResult = await verifyBrandOwnership(userId, brandId);
  if (!authResult.authorized) {
    return { statusCode: 404, body: { error: authResult.error } };
  }

  const draftContent = await prisma.content.findMany({
    where: { brandId, status: 'draft' },
    select: {
      id: true,
      caption: true,
      contentType: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      scheduledAt: true,
      brandId: true,
      generationParams: true,
      contentGroupId: true,
      contentSeriesId: true,
      targetSocialAccountId: true,
      recipeRunId: true,
      recipeRun: { select: { recipeTemplate: { select: { id: true, slug: true, name: true } } } },
      schedulingError: true,
      mediaAssets: {
        select: { assetId: true, displayOrder: true },
        orderBy: { displayOrder: 'asc' },
      },
      firstComment: true,
      firstCommentStatus: true,
      firstCommentPostedAt: true,
      firstCommentError: true,
      hashtags: true,
      shareToFeed: true,
    },
    orderBy: { updatedAt: 'desc' },
  });

  const content = buildContentListResponse(
    draftContent.map((item: any) => ({
      ...item,
      generatedByRecipe: item.recipeRun?.recipeTemplate ?? null,
    }))
  );

  return { statusCode: 200, body: { content } };
}

export function registerPendingContentRoute(fastify: FastifyInstance): void {
  fastify.get<{ Params: { brandId: string } }>(
    '/pending/:brandId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const typedRequest = request as AuthenticatedRequest;
        const response = await getPendingContentResponse(
          typedRequest.user!.id!,
          (request.params as { brandId: string }).brandId
        );

        if (response.statusCode !== 200) {
          return reply.code(response.statusCode).send(response.body);
        }

        return response.body;
      } catch (error) {
        request.log.error({ err: error }, 'Draft content error');
        throw error;
      }
    }
  );
}
