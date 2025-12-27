/**
 * Content Update Routes
 * Handles content updates including caption and scheduling changes
 */

import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@postolio/database';

import learningService from '../../services/learning.js';
import { schedulerService } from '../../services/scheduler.js';
import { publishingQueueScheduler } from '../../services/publishing-queue/queue-scheduler.js';
import { buildContentResponse } from '../../services/content-response-builder.js';
import { verifyContentEditable } from '../../services/content-operations/authorization.js';
import { getDatabaseClient } from '../../config/database.js';
import { getAssetsClient } from '../../services/assets-media.js';
import { getStatusBroadcaster } from '../../services/broadcast-registry.js';
import {
  validateContentPayload,
  type ContentType as ValidationContentType,
  type MediaType as ValidationMediaType,
} from '@postolio/content-validation';
import { extractHashtagsFromCaption } from '../../utils/hashtag-extractor.js';
import type { AssetRecord } from '@postolio/assets-client';
import { supportsScheduling, toValidationPlatform } from '../../utils/platform.js';

const prisma = getDatabaseClient();

function isDisconnected(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  return Boolean((metadata as any).disconnected);
}

interface UpdateContentBody {
  contentId: string;
  caption?: string;
  contentType?: ValidationContentType;
  scheduledAt?: string;
  shareToFeed?: boolean;
  firstComment?: string;
  targetSocialAccountId?: string | null;
}

const updatesRoutes: FastifyPluginAsync = async (fastify) => {
  // Update content (RESTful: PUT /:contentId)
  fastify.put<{
    Params: { contentId: string };
    Body: UpdateContentBody | Omit<UpdateContentBody, 'contentId'>;
  }>('/:contentId', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;

      const contentId = request.params.contentId;
      const {
        caption,
        contentType,
        scheduledAt,
        shareToFeed,
        firstComment,
        targetSocialAccountId,
      } = request.body as Partial<UpdateContentBody>;

      // Verify user owns the content and it's editable (not published)
      const authResult = await verifyContentEditable(userId, contentId);
      if (!authResult.authorized) {
        return reply.code(authResult.error?.includes('immutable') ? 400 : 404).send({
          error: authResult.error,
        });
      }

      // Get full content with campaign info
      const content = await prisma.content.findFirst({
        where: { id: contentId },
        include: {
          brand: {
            select: { userId: true, id: true },
          },
          campaign: {
            select: { id: true, status: true },
          },
          publishingQueueItem: {
            select: { id: true, queueId: true, laneKey: true },
          },
          mediaAssets: {
            select: { assetId: true, displayOrder: true },
            orderBy: { displayOrder: 'asc' },
          },
        },
      });

      if (!content || !content.brand) {
        return reply.code(404).send({ error: 'Content not found' });
      }

      // Store original content for learning analysis
      const originalContent: {
        caption: string;
        scheduledAt?: string;
      } = {
        caption: content.caption,
        ...(content.scheduledAt ? { scheduledAt: content.scheduledAt.toISOString() } : {}),
      };

      // Build update data - only include fields that are provided
      interface MutableContentUpdate {
        caption?: string;
        hashtags?: string[];
        contentType?: ValidationContentType;
        scheduledAt?: Date | null;
        status?: 'draft' | 'scheduled' | 'published' | 'failed' | 'skipped';
        shareToFeed?: boolean | null;
        firstComment?: string | null;
        targetSocialAccountId?: string | null;
      }
      const updateData: MutableContentUpdate = {};

      const effectiveContentType = (contentType ||
        content.contentType ||
        'post') as ValidationContentType;

      const effectiveCaption =
        caption !== undefined
          ? caption
          : (content.caption ?? (effectiveContentType === 'story' ? '' : ''));

      const normalizedTargetSocialAccountId = (() => {
        if (targetSocialAccountId === undefined) return undefined;
        if (targetSocialAccountId === null || targetSocialAccountId === '') return null;
        if (typeof targetSocialAccountId !== 'string') return '__invalid__';
        const trimmed = targetSocialAccountId.trim();
        return trimmed.length ? trimmed : null;
      })() as string | null | undefined;

      if (normalizedTargetSocialAccountId === '__invalid__') {
        return reply.code(400).send({
          error: 'Invalid targetSocialAccountId',
          details: ['targetSocialAccountId must be a string or null'],
        });
      }

      const existingTargetSocialAccountId =
        typeof (content as any).targetSocialAccountId === 'string' &&
        String((content as any).targetSocialAccountId).trim().length > 0
          ? String((content as any).targetSocialAccountId).trim()
          : null;

      const effectiveTargetSocialAccountId =
        normalizedTargetSocialAccountId === undefined
          ? existingTargetSocialAccountId
          : normalizedTargetSocialAccountId;

      let resolvedTargetSocialAccount: { id: string; platform: string } | null = null;
      let resolvedTargetSocialAccountDisconnected = false;
      if (effectiveTargetSocialAccountId) {
        const sa = await prisma.socialAccount.findFirst({
          where: {
            id: effectiveTargetSocialAccountId,
            brandId: content.brandId,
          },
          select: { id: true, platform: true, metadata: true },
        });

        if (!sa) {
          // If the client is explicitly setting a destination, enforce that it exists.
          // If the post already has a stored destination, allow edits even if the account is gone.
          if (normalizedTargetSocialAccountId !== undefined) {
            return reply.code(400).send({
              error: 'invalid_target_social_account',
              message: 'Target social account is not connected to this brand',
            });
          }
        } else {
          resolvedTargetSocialAccountDisconnected = isDisconnected(sa.metadata);
          // If the client is explicitly setting a destination, enforce that it is connected.
          if (
            normalizedTargetSocialAccountId !== undefined &&
            resolvedTargetSocialAccountDisconnected
          ) {
            return reply.code(400).send({
              error: 'invalid_target_social_account',
              message: 'Target social account is not connected to this brand',
            });
          }

          resolvedTargetSocialAccount = {
            id: sa.id,
            platform: String(sa.platform),
          };
        }
      }

      if (normalizedTargetSocialAccountId !== undefined) {
        updateData.targetSocialAccountId = normalizedTargetSocialAccountId
          ? resolvedTargetSocialAccount!.id
          : null;
      }

      const destinationPlatform = resolvedTargetSocialAccount?.platform ?? 'instagram';
      const schedulingSupported = supportsScheduling(destinationPlatform);
      const schedulingEligible =
        schedulingSupported &&
        (!effectiveTargetSocialAccountId ||
          (Boolean(resolvedTargetSocialAccount) && !resolvedTargetSocialAccountDisconnected));

      if (scheduledAt !== undefined && scheduledAt && !schedulingSupported) {
        return reply.code(400).send({
          error: 'scheduling_not_supported',
          message: `Scheduling is not yet supported for ${destinationPlatform}`,
        });
      }

      if (scheduledAt !== undefined && scheduledAt && !schedulingEligible) {
        return reply.code(400).send({
          error: 'invalid_target_social_account',
          message:
            'Selected destination account is no longer connected. Choose a different destination and try again.',
        });
      }

      const joinMediaAssets = (content.mediaAssets ?? [])
        .map((asset) => ({
          assetId: asset.assetId,
          displayOrder: asset.displayOrder,
        }))
        .sort((a, b) => a.displayOrder - b.displayOrder);
      const assetIds = joinMediaAssets
        .map((asset) => asset.assetId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);

      const isUnscheduling = scheduledAt !== undefined && !scheduledAt;
      const requiresPublishableValidation =
        !isUnscheduling &&
        (Boolean(content.publishingQueueItem) ||
          content.status === 'scheduled' ||
          (scheduledAt !== undefined && Boolean(scheduledAt)));

      if (requiresPublishableValidation) {
        let resolvedAssets: (AssetRecord | null)[] = [];
        if (assetIds.length > 0) {
          try {
            const assetsClient = getAssetsClient();
            resolvedAssets = await assetsClient.getBatchAssets(assetIds);
          } catch (error) {
            request.log.error(
              { err: error, contentId, assetCount: assetIds.length },
              'Failed to fetch media assets'
            );
            return reply
              .code(400)
              .send({ error: 'Failed to fetch linked media assets. Please try again.' });
          }
        }

        const missingAssets = resolvedAssets
          .map((asset, idx) => (!asset ? assetIds[idx] : null))
          .filter((id): id is string => Boolean(id));
        if (missingAssets.length > 0) {
          return reply.code(400).send({
            error: 'Some linked media assets could not be found',
            details: missingAssets,
          });
        }

        const resolvedById = new Map(
          (resolvedAssets.filter(Boolean) as AssetRecord[]).map((asset) => [asset.id, asset])
        );
        const mediaAssetsForValidation: { key: string; type: 'image' | 'video' }[] = joinMediaAssets
          .map((asset) => {
            const resolved = resolvedById.get(asset.assetId);
            if (!resolved) return null;
            return {
              key: resolved.id,
              type: resolved.fileType === 'video' ? 'video' : 'image',
            };
          })
          .filter((asset): asset is { key: string; type: 'image' | 'video' } => Boolean(asset));

        const mediaTypeHint: ValidationMediaType | undefined =
          effectiveContentType === 'reel'
            ? 'video'
            : mediaAssetsForValidation.some((asset) => asset.type === 'video')
              ? 'video'
              : mediaAssetsForValidation.length > 0
                ? 'image'
                : undefined;

        const validationPlatform = toValidationPlatform(destinationPlatform);
        if (!validationPlatform) {
          return reply.code(400).send({
            error: 'unsupported_platform',
            message: `Platform ${destinationPlatform} is not supported for content updates yet`,
          });
        }

        const validation = validateContentPayload({
          platform: validationPlatform,
          contentType: effectiveContentType,
          mediaType: mediaTypeHint,
          caption: effectiveContentType === 'story' ? '' : effectiveCaption,
          mediaAssets: mediaAssetsForValidation,
        });

        if (!validation.ok) {
          return reply.code(400).send({
            error: validation.errors[0]?.message || 'Invalid content payload',
            details: validation.errors,
          });
        }
      }

      if (caption !== undefined) {
        const normalizedCaption = effectiveCaption.trim();
        updateData.caption = normalizedCaption;
        updateData.hashtags = extractHashtagsFromCaption(normalizedCaption);
      }
      if (contentType !== undefined) {
        updateData.contentType = contentType;
      }
      if (scheduledAt !== undefined) {
        updateData.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;
        // When setting a scheduledAt date, ensure proper status
        if (scheduledAt) {
          // Set to scheduled when adding a scheduled time (allow from draft/failed/skipped)
          updateData.status = 'scheduled';
        } else if (scheduledAt === null && content.status === 'scheduled') {
          // If removing scheduledAt, revert to draft
          updateData.status = 'draft';
        }
      }

      if (shareToFeed !== undefined) {
        updateData.shareToFeed = shareToFeed ?? null;
      }

      if (firstComment !== undefined) {
        updateData.firstComment = firstComment || null;
      }

      // Log the update for debugging
      request.log.info(
        {
          contentId,
          updateData,
          originalScheduledAt: content.scheduledAt,
          originalStatus: content.status,
        },
        'Updating content with data'
      );

      // Check if content belongs to a campaign in preview (draft) state
      // If so, only update local database, don't schedule in AWS until campaign is started
      const isInDraftCampaign = content.campaign && content.campaign.status === 'preview';

      if (isInDraftCampaign && scheduledAt !== undefined) {
        console.log(
          `Content ${contentId} belongs to campaign ${content.campaign?.id} in preview state - updating database only, not scheduling in AWS`
        );
      }

      // Handle AWS scheduling operations FIRST before updating local DB
      // This prevents race conditions where local DB has new time but AWS doesn't
      const originalScheduledTime = content.scheduledAt?.toISOString();
      const newScheduledTime = updateData.scheduledAt?.toISOString();
      const requestedScheduledAt =
        (updateData.scheduledAt as Date | null | undefined) ?? content.scheduledAt ?? null;

      const isPausedCampaign = content.campaign && content.campaign.status === 'paused';
      if (
        schedulingSupported &&
        isPausedCampaign &&
        scheduledAt !== undefined &&
        originalScheduledTime !== newScheduledTime
      ) {
        return reply.code(409).send({
          success: false,
          code: 'CAMPAIGN_PAUSED',
          error: 'Campaign is paused. Unpause the campaign to reschedule posts.',
          data: null,
        });
      }

      // For new scheduling (wasn't scheduled, now is), perform AWS scheduling BEFORE DB update to avoid inconsistent state
      // Skip AWS operations if content belongs to a draft campaign
      let scheduledInAwsBeforeUpdate = false;
      let newScheduleFailed = false;
      let newScheduleError: string | undefined;
      let planLimitHit = false;
      let planLimitMessage: string | undefined;
      if (schedulingSupported && !isInDraftCampaign && !originalScheduledTime && newScheduledTime) {
        try {
          // Ensure firstComment is persisted before creating the AWS schedule
          // so the scheduler and publisher receive the latest text.
          if (firstComment !== undefined) {
            await prisma.content.update({
              where: { id: contentId },
              data: {
                firstComment: firstComment || null,
              },
            });
          }

          console.log(
            `Attempting to create new AWS schedule for content ${contentId} at ${newScheduledTime} before DB update`
          );
          // Pass the requested time directly; adapter will convert timezone appropriately
          const scheduleResult = await schedulerService.scheduleContent(
            contentId,
            updateData.scheduledAt!
          );

          if (!scheduleResult.success) {
            console.error('AWS new schedule failed (pre-DB update):', scheduleResult.error);
            if (
              typeof scheduleResult.error === 'string' &&
              scheduleResult.error.toLowerCase().includes('upgrade required')
            ) {
              planLimitHit = true;
              planLimitMessage = scheduleResult.error;
            }
            newScheduleFailed = true;
            newScheduleError = scheduleResult.error || 'Scheduling failed';
          } else {
            scheduledInAwsBeforeUpdate = true;
            console.log(`AWS new schedule created for content ${contentId}`);
          }
        } catch (preScheduleError) {
          console.error('Error during AWS new schedule (pre-DB update):', preScheduleError);
          newScheduleFailed = true;
          newScheduleError =
            preScheduleError instanceof Error
              ? preScheduleError.message
              : 'Scheduling failed unexpectedly';
        }
      }

      // Check if this is a reschedule operation (time changed)
      // Skip AWS operations if content belongs to a draft campaign
      let needsNewSchedule = false;
      if (
        schedulingSupported &&
        !isInDraftCampaign &&
        originalScheduledTime &&
        newScheduledTime &&
        originalScheduledTime !== newScheduledTime
      ) {
        try {
          request.log.info(
            { contentId, originalScheduledTime, newScheduledTime },
            'Attempting to reschedule content'
          );

          // Call AWS reschedule FIRST - fail fast if this doesn't work
          const rescheduleResult = await schedulerService.reschedulePost(
            contentId,
            updateData.scheduledAt!
          );

          if (!rescheduleResult.success) {
            request.log.error(
              { error: rescheduleResult.error, contentId },
              'AWS reschedule failed'
            );

            // Check if reschedule failed because content was never scheduled
            // In this case, we'll create a new schedule instead of erroring
            if (
              rescheduleResult.error?.toLowerCase().includes('not scheduled') ||
              rescheduleResult.error?.toLowerCase().includes('content is not scheduled') ||
              rescheduleResult.error?.toLowerCase().includes('not found') ||
              rescheduleResult.error?.toLowerCase().includes('missing') ||
              rescheduleResult.error?.toLowerCase().includes('does not exist')
            ) {
              request.log.info(
                { contentId },
                'Content was never scheduled in AWS - will create new schedule instead'
              );
              needsNewSchedule = true;
              // Don't return error - fall through to create new schedule
            } else if (rescheduleResult.error?.includes('AWS scheduler temporarily unavailable')) {
              return reply.code(503).send({
                success: false,
                error:
                  'Scheduling service is temporarily unavailable. Please try again in a few moments.',
                data: null,
              });
            } else {
              // Other errors should still fail
              return reply.code(500).send({
                success: false,
                error: rescheduleResult.error,
                data: null,
              });
            }
          } else {
            request.log.info({ contentId }, 'AWS reschedule succeeded for content');
          }
        } catch (rescheduleError) {
          request.log.error({ err: rescheduleError, contentId }, 'Error during AWS reschedule');
          return reply.code(500).send({
            success: false,
            error: `Reschedule failed: ${rescheduleError instanceof Error ? rescheduleError.message : 'Unknown error'}`,
            data: null,
          });
        }
      }

      if (newScheduleFailed) {
        const message =
          planLimitHit && planLimitMessage
            ? planLimitMessage
            : newScheduleError || 'Failed to schedule content';
        const status = planLimitHit ? 402 : 500;

        // Do not mutate state on plan-limit failures; treat as a blocker and preserve original time.
        if (!planLimitHit) {
          // Persist failure state so UI shows failed instead of scheduled/draft ambiguity
          try {
            await prisma.content.update({
              where: { id: contentId },
              data: {
                status: 'failed',
                scheduledAt: requestedScheduledAt,
                schedulingError: message,
              },
            });
          } catch (persistError) {
            request.log.error(
              { err: persistError, contentId },
              'Failed to persist scheduling failure state'
            );
          }
        }

        return reply.code(status).send({
          success: false,
          error: message,
          data: null,
        });
      }

      // Only update local DB after AWS operations succeed (or if no AWS operation needed)
      const updatedContent = await prisma.content.update({
        where: { id: contentId },
        data: updateData as unknown as Prisma.ContentUpdateInput,
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
          contentType: true,
          campaignId: true,
          contentGroupId: true,
          targetSocialAccountId: true,
          schedulingError: true,
          generationParams: true,
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

      // Log the result for debugging
      request.log.info(
        {
          contentId: updatedContent.id,
          newScheduledAt: updatedContent.scheduledAt,
          newStatus: updatedContent.status,
          updateSuccessful: true,
        },
        'Content update result'
      );

      // Handle scheduling changes with AWS ContentScheduler
      // Skip AWS operations if content belongs to a draft campaign
      if (
        schedulingSupported &&
        scheduledAt !== undefined &&
        !isInDraftCampaign &&
        !scheduledInAwsBeforeUpdate
      ) {
        const originalScheduledTime = content.scheduledAt?.toISOString();
        const newScheduledTime = updatedContent.scheduledAt?.toISOString();

        // Case 1: New schedule (wasn't scheduled before, now is) OR reschedule that failed due to missing AWS schedule
        if ((!originalScheduledTime && newScheduledTime) || needsNewSchedule) {
          try {
            // Don't pass customTime - scheduler-adapter will read from DB (UTC)
            const scheduleResult = await schedulerService.scheduleContent(contentId);

            if (!scheduleResult.success) {
              console.error('Failed to create AWS schedule:', scheduleResult.error);
              if (
                typeof scheduleResult.error === 'string' &&
                scheduleResult.error.toLowerCase().includes('upgrade required')
              ) {
                planLimitHit = true;
                planLimitMessage = scheduleResult.error;
              }

              // Persist failure so UI does not show Scheduled when AWS scheduling failed post-DB update
              try {
                await prisma.content.update({
                  where: { id: contentId },
                  data: {
                    status: 'failed',
                    scheduledAt: requestedScheduledAt,
                    schedulingError:
                      scheduleResult.error || 'Scheduling failed after saving the post.',
                  },
                });
              } catch (persistErr) {
                console.error('Failed to persist scheduling failure state (post-DB)', persistErr);
              }

              return reply.code(planLimitHit ? 402 : 502).send({
                success: false,
                error:
                  scheduleResult.error ||
                  'Scheduling service unavailable. Your post was saved but not scheduled.',
                data: null,
              });

              // If this is auto-recovery from failed reschedule and scheduling still fails,
              // return error to user with helpful message
              // Do NOT return 500 here; degrade gracefully like initial scheduling
              // The DB reflects the requested scheduled time; adapter stored schedulingError
            } else {
              console.log(`Content ${contentId} scheduled successfully in AWS`);
              if (needsNewSchedule) {
                console.log(
                  `Auto-recovery successful - created new schedule after failed reschedule`
                );
              }
            }
          } catch (scheduleError) {
            console.error('Error creating schedule:', scheduleError);
            // Persist failure so UI doesn't show Scheduled when AWS call throws
            try {
              await prisma.content.update({
                where: { id: contentId },
                data: {
                  status: 'failed',
                  scheduledAt: requestedScheduledAt,
                  schedulingError:
                    scheduleError instanceof Error
                      ? scheduleError.message
                      : 'Scheduling failed unexpectedly',
                },
              });
            } catch (persistErr) {
              console.error('Failed to persist scheduling failure state (exception)', persistErr);
            }

            return reply.code(502).send({
              success: false,
              error: 'Scheduling service unavailable. Your post was saved but not scheduled.',
              data: null,
            });
          }
        }
        // Case 2: Cancel schedule (was scheduled, now isn't)
        else if (originalScheduledTime && !newScheduledTime) {
          try {
            const cancelResult = await schedulerService.cancelScheduledPost(contentId);

            if (cancelResult) {
              request.log.info({ contentId }, 'Schedule cancelled successfully');
            } else {
              request.log.error({ contentId }, 'Failed to cancel AWS schedule for content');
            }
          } catch (cancelError) {
            request.log.error({ err: cancelError, contentId }, 'Error cancelling schedule');
          }
        }
        // Note: Reschedule logic moved earlier in the flow to prevent race conditions
        // AWS operations now happen BEFORE local DB updates
      } else if (scheduledAt !== undefined && isInDraftCampaign) {
        request.log.info(
          { contentId, campaignId: content.campaign?.id },
          'Skipping AWS scheduling operations for draft campaign content'
        );
      }

      // If the post is scheduled and its content changed (caption/media/etc), sync the AWS schedule payload.
      // This ensures the publisher uses the latest post content at publish time.
      const contentChanged =
        caption !== undefined ||
        contentType !== undefined ||
        shareToFeed !== undefined ||
        firstComment !== undefined;
      const timeChanged = Boolean(
        originalScheduledTime && newScheduledTime && originalScheduledTime !== newScheduledTime
      );

      if (
        schedulingSupported &&
        !isInDraftCampaign &&
        updatedContent.scheduledAt &&
        contentChanged &&
        !timeChanged
      ) {
        try {
          const syncResult = await schedulerService.updateScheduledContent(contentId);
          if (!syncResult.success) {
            request.log.warn(
              { contentId, error: syncResult.error },
              'Failed to sync schedule payload after content update'
            );
          }
        } catch (syncError) {
          request.log.warn(
            { contentId, err: syncError },
            'Error syncing schedule payload after content update'
          );
        }
      }

      // Queue triggers:
      // - If a queued post is manually scheduled at a fixed time, remove it from the queue (becomes fixed-time).
      // - If a queued post's contentType changes, move it to the end of the new lane and recompute.
      const queueItem = content.publishingQueueItem;
      const manualScheduled = scheduledAt !== undefined && Boolean(scheduledAt);
      const requestedLaneKey =
        contentType === 'reel' || contentType === 'story' || contentType === 'post'
          ? contentType
          : null;

      try {
        if (queueItem) {
          if (manualScheduled) {
            await prisma.publishingQueueItem.delete({ where: { id: queueItem.id } });
            await publishingQueueScheduler.recomputeBrandWindow(content.brand.id);
          } else if (requestedLaneKey && requestedLaneKey !== String(queueItem.laneKey)) {
            const maxPosition = await prisma.publishingQueueItem.findFirst({
              where: { queueId: queueItem.queueId, laneKey: requestedLaneKey },
              select: { position: true },
              orderBy: { position: 'desc' },
            });

            await prisma.publishingQueueItem.update({
              where: { id: queueItem.id },
              data: {
                laneKey: requestedLaneKey,
                position: (maxPosition?.position ?? 0) + 1,
              },
            });

            await publishingQueueScheduler.recomputeBrandWindow(content.brand.id);
          }
        }
      } catch (queueError) {
        request.log.warn(
          { err: queueError, contentId },
          'Queue maintenance failed after content update'
        );
      }

      // Apply AI learning if there were changes
      let learningResults = null;
      const hasChanges =
        (caption !== undefined && caption !== originalContent.caption) ||
        (scheduledAt !== undefined && scheduledAt !== originalContent.scheduledAt);

      if (hasChanges) {
        try {
          const editedContent: {
            caption: string;
            scheduledAt?: string;
          } = {
            caption: updatedContent.caption,
            ...(updatedContent.scheduledAt
              ? { scheduledAt: updatedContent.scheduledAt.toISOString() }
              : {}),
          };

          // Analyze the edit and apply learning (async, don't block response)
          // Additional safety check for brand (should not be null due to earlier check, but defensive programming)
          if (content.brand?.id) {
            learningService
              .analyzeUserEdit(content.brand.id, originalContent, editedContent)
              .then((editAnalysis) =>
                learningService.applyLearningToStyleProfile(content.brand.id, editAnalysis)
              )
              .then((results) => {
                request.log.info(
                  {
                    brandId: content.brand.id,
                    insights: results.insights.length,
                    profileUpdates: results.profileUpdates.length,
                    appliedToFuturePosts: results.appliedToFuturePosts,
                  },
                  'Learning applied for brand'
                );
              })
              .catch((error) => {
                request.log.error({ err: error, brandId: content.brand.id }, 'Learning error');
              });

            // Provide immediate feedback about learning
            learningResults = {
              learningActive: true,
              message: 'AI is learning from your edits...',
            };
          }
        } catch (error) {
          request.log.error({ err: error, brandId: content.brand?.id }, 'Learning analysis error');
        }
      }

      // Build CDN URL from S3 key and map to public response format
      const contentWithUrl = buildContentResponse(updatedContent);

      // Best-effort: notify other clients to refresh calendars/content when schedule/time changes.
      try {
        const broadcaster = getStatusBroadcaster();
        if (broadcaster && content.brand?.id) {
          void broadcaster.broadcastStatusChange(
            contentId,
            content.brand.id,
            content.status,
            updatedContent.status as any,
            {
              kind: 'content_updated',
              scheduledAt: updatedContent.scheduledAt
                ? updatedContent.scheduledAt.toISOString()
                : null,
            }
          );
        }
      } catch {
        // ignore
      }

      return {
        content: contentWithUrl,
        learning: learningResults,
        ...(planLimitHit ? { upsell: { upgradeRequired: true, message: planLimitMessage } } : {}),
      };
    } catch (error) {
      request.log.error({ err: error }, 'Content update error');
      throw error;
    }
  });

  // Schedule content (RESTful: POST /:contentId/schedule)
  fastify.post<{ Params: { contentId: string }; Body: { scheduledAt?: string } }>(
    '/:contentId/schedule',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const contentId = request.params.contentId;
      const scheduledAt = request.body?.scheduledAt;

      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (typeof request.headers.cookie === 'string') headers.cookie = request.headers.cookie;
      if (typeof request.headers.authorization === 'string')
        headers.authorization = request.headers.authorization;
      if (typeof request.headers['csrf-token'] === 'string')
        headers['csrf-token'] = request.headers['csrf-token'];

      const r = await fastify.inject({
        method: 'PUT',
        url: `/api/content/${encodeURIComponent(contentId)}`,
        payload: { scheduledAt },
        headers,
      });

      return reply.code(r.statusCode).send(r.json());
    }
  );
};

export default updatesRoutes;
