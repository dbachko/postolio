/**
 * Content Management Routes
 * Handles content CRUD operations: create, read, approve, reject, delete
 */

import { FastifyPluginAsync } from 'fastify';

import { schedulerService } from '../../services/scheduler.js';
import {
  buildContentResponse,
  buildContentListResponse,
} from '../../services/content-response-builder.js';
import {
  verifyBrandOwnership,
  verifyContentOwnership,
  verifyContentDeletable,
} from '../../services/content-operations/authorization.js';
import { getDatabaseClient } from '../../config/database.js';
import {
  validateRequestBody,
  verifyBrandAndCampaign,
  resolveAssets,
  validateInstagramContentForCreate,
  createContentInTransaction,
  handleScheduling,
  type CreateManualContentBody,
  type ApproveContentBody,
} from '../../utils/content-management.js';

const prisma = getDatabaseClient();

const managementRoutes: FastifyPluginAsync = async (fastify) => {
  // Create manual content (user-generated, not AI) - RESTful: POST /
  fastify.post<{ Body: CreateManualContentBody }>(
    '/',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const body = request.body;

        // Validate request body
        const validationResult = validateRequestBody(body);
        if (!validationResult.ok) {
          return reply.code(400).send(validationResult.error);
        }

        // Verify brand and campaign access (throws APIError on failure)
        await verifyBrandAndCampaign(userId, body.brandId, body.campaignId);

        // Resolve assets (unified for single and carousel)
        const assetResult = await resolveAssets(body.assetIds, body.brandId, request);
        if (!assetResult.success) {
          return reply.code(assetResult.code || 500).send({ error: assetResult.error });
        }

        const assetsForValidation = assetResult.resolvedAssets ?? [];
        const validation = validateInstagramContentForCreate({
          caption: body.caption,
          contentType: body.contentType ?? 'post',
          assets: assetsForValidation,
        });
        if (!validation.ok) {
          return reply.code(400).send(validation.error);
        }

        // Create content in transaction
        const content = await createContentInTransaction(
          {
            brandId: body.brandId,
            caption: body.caption,
            contentType: body.contentType,
            campaignId: body.campaignId,
            scheduledAt: body.scheduledAt,
            shareToFeed: body.shareToFeed,
            firstComment: body.firstComment,
            resolvedAssets: assetResult.resolvedAssets ?? [],
          },
          prisma
        );

        if (!content) {
          return reply.code(500).send({ error: 'Failed to create content' });
        }

        // Handle scheduling if needed
        const upsell = await handleScheduling(content.id, body.scheduledAt);

        // Build response
        const contentWithUrl = buildContentResponse(content);

        return reply.code(201).send({
          content: contentWithUrl,
          metadata: {
            brandId: body.brandId,
            source: 'manual',
          },
          ...(upsell ? { upsell } : {}),
        });
      } catch (error) {
        request.log.error({ err: error }, 'Manual content creation error');
        throw error;
      }
    }
  );

  // Get draft content for review
  fastify.get<{ Params: { brandId: string } }>(
    '/pending/:brandId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;

        const { brandId } = request.params;

        // Verify user owns the brand
        const authResult = await verifyBrandOwnership(userId, brandId);
        if (!authResult.authorized) {
          return reply.code(404).send({ error: authResult.error });
        }

        const draftContent = await prisma.content.findMany({
          where: {
            brandId,
            status: 'draft',
          },
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
            campaignId: true,
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
          // For draft review, default to last modified first
          orderBy: { updatedAt: 'desc' },
        });

        // Build CDN URLs from S3 keys and map to public response format
        const contentWithUrls = buildContentListResponse(draftContent);

        return { content: contentWithUrls };
      } catch (error) {
        request.log.error({ err: error }, 'Draft content error');
        throw error;
      }
    }
  );

  // Approve content for posting
  fastify.post<{ Body: ApproveContentBody }>(
    '/approve',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;

        const { contentId, scheduledAt } = request.body;

        // Verify user owns the content through brand ownership
        const authResult = await verifyContentOwnership(userId, contentId);
        if (!authResult.authorized) {
          return reply.code(404).send({ error: authResult.error });
        }

        // Get content with campaign info
        const content = await prisma.content.findFirst({
          where: { id: contentId },
          include: {
            campaign: {
              select: { id: true, status: true },
            },
          },
        });

        if (!content) {
          return reply.code(404).send({ error: 'Content not found' });
        }

        if (content.status !== 'draft') {
          return reply.code(400).send({ error: 'Content is not in draft status' });
        }

        // Update content status - use 'scheduled' if scheduledAt provided
        const updatedContent = await prisma.content.update({
          where: { id: contentId },
          data: {
            status: scheduledAt ? 'scheduled' : 'draft',
            scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
          },
          select: {
            id: true,
            caption: true,
            status: true,
            scheduledAt: true,
            updatedAt: true,
          },
        });

        // Check if content belongs to a campaign in preview (draft) state
        const isInDraftCampaign = content.campaign && content.campaign.status === 'preview';

        // If scheduledAt is provided, create a schedule in AWS (unless in draft campaign)
        if (scheduledAt) {
          if (isInDraftCampaign) {
            request.log.info(
              { contentId, campaignId: content.campaign?.id },
              'Content belongs to preview campaign - skipping AWS scheduling'
            );
          } else {
            try {
              // Don't pass customTime - let scheduler-adapter read scheduledAt from database
              // This avoids timezone conversion issues since DB stores UTC
              const scheduleResult = await schedulerService.scheduleContent(contentId);

              if (!scheduleResult.success) {
                request.log.error(
                  { err: scheduleResult.error, contentId },
                  'Failed to create AWS schedule'
                );
                // Note: We don't fail the request here as the content is already scheduled locally
                // The scheduler adapter has fallback logic
              } else {
                request.log.info({ contentId }, 'Content scheduled successfully in AWS');
              }
            } catch (scheduleError) {
              request.log.error(
                { err: scheduleError, contentId },
                'Error calling scheduler service'
              );
              // Continue with local scheduling
            }
          }
        }

        return { content: updatedContent };
      } catch (error) {
        request.log.error({ err: error }, 'Content approval error');
        throw error;
      }
    }
  );

  // Reject content
  fastify.post<{ Params: { contentId: string } }>(
    '/reject/:contentId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;

        const { contentId } = request.params;

        // Verify user owns the content through brand ownership
        const authResult = await verifyContentOwnership(userId, contentId);
        if (!authResult.authorized) {
          return reply.code(404).send({ error: authResult.error });
        }

        // Update content status - reject means back to draft
        const updatedContent = await prisma.content.update({
          where: { id: contentId },
          data: {
            status: 'draft',
            scheduledAt: null, // Clear any scheduled time
          },
          select: {
            id: true,
            status: true,
            updatedAt: true,
          },
        });

        return { content: updatedContent };
      } catch (error) {
        request.log.error({ err: error }, 'Content rejection error');
        throw error;
      }
    }
  );

  // Delete content (RESTful: DELETE /:contentId)
  fastify.delete<{ Params: { contentId: string } }>(
    '/:contentId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { contentId } = request.params;

      // Verify user owns the content and it's deletable (not published)
      const authResult = await verifyContentDeletable(userId, contentId);
      if (!authResult.authorized) {
        return reply
          .code(authResult.error?.includes('published') ? 400 : 404)
          .send({ error: authResult.error });
      }

      const item = await prisma.content.findFirst({
        where: { id: contentId },
        select: { status: true },
      });
      if (!item) return reply.code(404).send({ error: 'Content not found' });

      // Best-effort cancel schedule
      try {
        if (item.status === 'scheduled') {
          await schedulerService.cancelScheduledPost(contentId);
        }
      } catch (e) {
        request.log.warn({ err: e, contentId }, 'Failed to cancel schedule during delete');
      }

      await prisma.content.delete({ where: { id: contentId } });
      return reply.send({ success: true, deleted: { id: contentId } });
    }
  );
};

export default managementRoutes;
