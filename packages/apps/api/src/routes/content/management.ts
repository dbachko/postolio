/**
 * Content Management Routes
 * Handles content CRUD operations: create, read, approve, reject, delete
 */

import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@postolio/database';

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
  resolveAssets,
  createContentInTransaction,
  handleScheduling,
  type CreateManualContentBody,
  type ApproveContentBody,
} from '../../utils/content-management.js';
import { resolvePrimarySocialAccount } from '../../services/social-account-resolver.js';
import { validateContentPayload } from '@postolio/content-validation';
import { extractHashtagsFromCaption } from '../../utils/hashtag-extractor.js';
import { supportsScheduling, toValidationPlatform } from '../../utils/platform.js';

const prisma = getDatabaseClient();

function isDisconnected(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  return Boolean((metadata as any).disconnected);
}

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

        // Verify user owns the brand
        const authResult = await verifyBrandOwnership(userId, body.brandId);
        if (!authResult.authorized) {
          return reply.code(404).send({ error: authResult.error });
        }

        const requestedTargetIds = Array.isArray((body as any).targetSocialAccountIds)
          ? (body as any).targetSocialAccountIds
              .filter((v: unknown): v is string => typeof v === 'string')
              .map((v: string) => v.trim())
              .filter((v: string) => v.length > 0)
          : null;

        // Resolve destination social accounts:
        // - Prefer explicit targetSocialAccountIds (multi-destination)
        // - Fall back to targetSocialAccountId (single destination)
        // - Fall back to brand primary Instagram account (legacy behavior)
        const destinationAccounts = (() => {
          if (requestedTargetIds) return requestedTargetIds;
          if (body.targetSocialAccountId === undefined) return null;
          if (body.targetSocialAccountId === null || body.targetSocialAccountId === '') return [];
          return [body.targetSocialAccountId];
        })();

        let resolvedDestinations: Array<{ id: string; platform: string; metadata: unknown }> = [];
        if (Array.isArray(destinationAccounts)) {
          const uniqueIds = Array.from(new Set(destinationAccounts));
          if (uniqueIds.length > 0) {
            const accounts = await prisma.socialAccount.findMany({
              where: { brandId: body.brandId, id: { in: uniqueIds } },
              select: { id: true, platform: true, metadata: true },
            });
            const byId = new Map(accounts.map((a) => [a.id, a]));
            const invalid: string[] = [];
            resolvedDestinations = uniqueIds
              .map((id) => {
                const match = byId.get(id);
                if (!match) {
                  invalid.push(id);
                  return null;
                }
                if (isDisconnected(match.metadata)) {
                  invalid.push(id);
                  return null;
                }
                return { id: match.id, platform: String(match.platform), metadata: match.metadata };
              })
              .filter(Boolean) as Array<{ id: string; platform: string; metadata: unknown }>;

            if (invalid.length > 0) {
              return reply.code(400).send({
                error: 'invalid_target_social_account',
                message: 'One or more destination social accounts are not connected to this brand',
                details: invalid,
              });
            }
          }
        } else {
          // Legacy behavior: no explicit destination provided.
          const primary = await resolvePrimarySocialAccount(body.brandId, 'instagram');
          if (primary) {
            resolvedDestinations = [
              { id: primary.id, platform: primary.platform, metadata: primary.metadata },
            ];
          } else {
            resolvedDestinations = [];
          }
        }

        const isDraftCreate = !body.scheduledAt;

        // Resolve assets (unified for single and carousel)
        const assetResult = await resolveAssets(body.assetIds, body.brandId, request, {
          enforceUniformAspectRatio: !isDraftCreate,
        });
        if (!assetResult.success) {
          return reply.code(assetResult.code || 500).send({ error: assetResult.error });
        }

        const normalizedContentType = (body.contentType ?? 'post') as any;
        const resolvedAssets = assetResult.resolvedAssets ?? [];

        if (!isDraftCreate) {
          // Extra constraints (current product limitations):
          // - Reels require exactly one video asset
          // - Carousels currently support images only
          if (normalizedContentType === 'reel') {
            if (resolvedAssets.length !== 1 || resolvedAssets[0]?.fileType !== 'video') {
              return reply.code(400).send({
                error: 'invalid_media',
                message: 'Reels require exactly one video asset',
              });
            }
          }
          if (resolvedAssets.length > 1) {
            const nonImages = resolvedAssets.filter((a) => a.fileType !== 'image');
            if (nonImages.length > 0) {
              return reply.code(400).send({
                error: 'invalid_media',
                message: 'Carousels currently support images only',
              });
            }
          }

          const mediaAssetsForValidation = resolvedAssets.map((asset) => ({
            key: asset.id,
            type: asset.fileType === 'video' ? ('video' as const) : ('image' as const),
          }));
          const mediaTypeHint =
            normalizedContentType === 'reel' ||
            mediaAssetsForValidation.some((a) => a.type === 'video')
              ? 'video'
              : mediaAssetsForValidation.length > 0
                ? 'image'
                : undefined;
          const captionForValidation = normalizedContentType === 'story' ? '' : body.caption;

          const platformsToValidate =
            resolvedDestinations.length > 0
              ? resolvedDestinations.map((d) => d.platform)
              : ['instagram'];

          for (const platform of platformsToValidate) {
            const validationPlatform = toValidationPlatform(platform);
            if (!validationPlatform) {
              return reply.code(400).send({
                error: 'unsupported_platform',
                message: `Platform ${platform} is not supported for content creation yet`,
              });
            }

            const validation = validateContentPayload({
              platform: validationPlatform,
              contentType: normalizedContentType,
              mediaType: mediaTypeHint,
              caption: captionForValidation,
              mediaAssets: mediaAssetsForValidation,
            });

            if (!validation.ok) {
              return reply.code(400).send({
                error: 'invalid_content',
                message: validation.errors[0]?.message || 'Invalid content payload',
                platform,
                details: validation.errors,
              });
            }
          }
        }

        // Scheduling is platform-dependent.
        if (body.scheduledAt && resolvedDestinations.some((d) => !supportsScheduling(d.platform))) {
          return reply.code(400).send({
            error: 'scheduling_not_supported',
            message: 'Scheduling is not yet supported for one or more selected destinations',
            details: Array.from(
              new Set(
                resolvedDestinations
                  .filter((d) => !supportsScheduling(d.platform))
                  .map((d) => d.platform)
              )
            ),
          });
        }

        const status = body.scheduledAt ? 'scheduled' : 'draft';
        const hashtags = extractHashtagsFromCaption(body.caption);

        // Create content (single) or a content group (multi-destination)
        let created: { contentGroupId: string | null; contents: any[] };
        if (resolvedDestinations.length <= 1) {
          const targetSocialAccountId = resolvedDestinations[0]?.id ?? null;
          const content = await createContentInTransaction(
            {
              brandId: body.brandId,
              caption: body.caption,
              contentType: body.contentType,
              scheduledAt: body.scheduledAt,
              shareToFeed: body.shareToFeed,
              firstComment: body.firstComment,
              contentGroupId: null,
              targetSocialAccountId,
              resolvedAssets,
            },
            prisma
          );
          created = { contentGroupId: null, contents: content ? [content] : [] };
        } else {
          created = await prisma.$transaction(async (tx) => {
            const group = await tx.contentGroup.create({
              data: {
                brandId: body.brandId,
                templateInitialized: true,
                templateCaption: body.caption,
                templateContentType: body.contentType || 'post',
                templateShareToFeed: body.shareToFeed ?? null,
                templateFirstComment: body.firstComment ? body.firstComment.trim() : null,
                templateThumbOffset: null,
                templateAssetIds: resolvedAssets.map((asset) => asset.id),
              },
              select: { id: true },
            });

            const createdIds: string[] = [];
            for (const dest of resolvedDestinations) {
              const row = await tx.content.create({
                data: {
                  caption: body.caption,
                  hashtags,
                  status,
                  brandId: body.brandId,
                  contentGroupId: group.id,
                  scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
                  contentType: body.contentType || 'post',
                  shareToFeed: body.shareToFeed ?? null,
                  firstComment: body.firstComment ? body.firstComment.trim() : null,
                  targetSocialAccountId: dest.id,
                  generationParams: Prisma.JsonNull,
                },
                select: { id: true },
              });
              createdIds.push(row.id);
            }

            if (resolvedAssets.length > 0) {
              await tx.contentMediaAsset.createMany({
                data: createdIds.flatMap((contentId) =>
                  resolvedAssets.map((asset, idx) => ({
                    contentId,
                    assetId: asset.id,
                    displayOrder: idx,
                  }))
                ),
              });
            }

            const contents = await tx.content.findMany({
              where: { id: { in: createdIds } },
              select: {
                id: true,
                caption: true,
                hashtags: true,
                status: true,
                brandId: true,
                contentGroupId: true,
                targetSocialAccountId: true,
                schedulingError: true,
                generationParams: true,
                createdAt: true,
                updatedAt: true,
                scheduledAt: true,
                postedAt: true,
                contentType: true,
                shareToFeed: true,
                firstComment: true,
                firstCommentStatus: true,
                firstCommentPostedAt: true,
                firstCommentError: true,
                mediaAssets: {
                  select: { assetId: true, displayOrder: true },
                  orderBy: { displayOrder: 'asc' },
                },
              },
            });

            const byId = new Map(contents.map((c) => [c.id, c]));
            const ordered = createdIds.map((id) => byId.get(id)).filter(Boolean) as typeof contents;
            return { contentGroupId: group.id, contents: ordered };
          });
        }

        if (created.contents.length === 0) {
          return reply.code(500).send({ error: 'Failed to create content' });
        }

        // Handle scheduling if needed (one per destination)
        let upsell: any | null = null;
        if (body.scheduledAt) {
          for (const content of created.contents) {
            const u = await handleScheduling(content.id, body.scheduledAt);
            if (u && !upsell) upsell = u;
          }
        }

        const contentResponses = created.contents.map(buildContentResponse);
        return reply.code(201).send({
          content: contentResponses[0],
          contents: created.contents.length > 1 ? contentResponses : undefined,
          contentGroupId: created.contentGroupId,
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
        const contentWithUrls = buildContentListResponse(
          draftContent.map((c: any) => ({
            ...c,
            generatedByRecipe: c.recipeRun?.recipeTemplate ?? null,
          }))
        );

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

        const content = await prisma.content.findFirst({
          where: { id: contentId },
          select: {
            id: true,
            status: true,
            brandId: true,
            targetSocialAccountId: true,
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

        // If scheduledAt is provided, create a schedule in AWS
        if (scheduledAt) {
          if (content.targetSocialAccountId) {
            const sa = await prisma.socialAccount.findFirst({
              where: {
                id: content.targetSocialAccountId,
                brandId: content.brandId,
              },
              select: { platform: true, metadata: true },
            });
            if (!sa || isDisconnected(sa.metadata)) {
              return reply.code(400).send({
                error: 'invalid_target_social_account',
                message: 'Target social account is not connected to this brand',
              });
            }
            if (!supportsScheduling(String(sa.platform))) {
              return reply.code(400).send({
                error: 'scheduling_not_supported',
                message: `Scheduling is not yet supported for ${String(sa.platform)}`,
              });
            }
          }

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
            request.log.error({ err: scheduleError, contentId }, 'Error calling scheduler service');
            // Continue with local scheduling
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
