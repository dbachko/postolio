/**
 * Content Update Routes
 * Handles content updates including caption, hashtags, and scheduling changes
 */

import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@postolio/database';

import learningService from '../../services/learning.js';
import { schedulerService } from '../../services/scheduler.js';
import { buildContentResponse } from '../../services/content-response-builder.js';
import { normalizeHashtags } from '../../utils/hashtag-normalizer.js';
import { verifyContentEditable } from '../../services/content-operations/authorization.js';
import { getDatabaseClient } from '../../config/database.js';

const prisma = getDatabaseClient();

interface UpdateContentBody {
  contentId: string;
  caption?: string;
  hashtags?: string[];
  scheduledAt?: string;
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
      const { caption, hashtags, scheduledAt } = request.body as Partial<UpdateContentBody>;

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
        },
      });

      if (!content || !content.brand) {
        return reply.code(404).send({ error: 'Content not found' });
      }

      // Store original content for learning analysis
      const originalContent: {
        caption: string;
        hashtags: string[];
        scheduledAt?: string;
      } = {
        caption: content.caption,
        hashtags: content.hashtags,
        ...(content.scheduledAt ? { scheduledAt: content.scheduledAt.toISOString() } : {}),
      };

      // Build update data - only include fields that are provided
      interface MutableContentUpdate {
        caption?: string;
        hashtags?: string[];
        scheduledAt?: Date | null;
        status?: 'draft' | 'scheduled' | 'published' | 'failed' | 'skipped';
      }
      const updateData: MutableContentUpdate = {};
      if (caption !== undefined) {
        // Strict validation: caption must be a non-empty string
        if (!caption || typeof caption !== 'string' || caption.trim().length === 0) {
          console.error(
            'CRITICAL: Attempt to update content with invalid caption',
            JSON.stringify({
              contentId,
              caption,
              captionType: typeof caption,
              captionLength: typeof caption === 'string' ? caption.length : 0,
            })
          );
          return reply.code(400).send({ error: 'Caption cannot be empty or invalid' });
        }
        updateData.caption = caption.trim(); // Ensure we store trimmed caption
      }
      if (hashtags !== undefined) {
        updateData.hashtags = normalizeHashtags(hashtags);
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

      // Log the update for debugging
      console.log(
        'Updating content with data:',
        JSON.stringify({
          contentId,
          updateData,
          originalScheduledAt: content.scheduledAt,
          originalStatus: content.status,
        })
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

      // For new scheduling (wasn't scheduled, now is), perform AWS scheduling BEFORE DB update to avoid inconsistent state
      // Skip AWS operations if content belongs to a draft campaign
      let scheduledInAwsBeforeUpdate = false;
      let planLimitHit = false;
      let planLimitMessage: string | undefined;
      if (!isInDraftCampaign && !originalScheduledTime && newScheduledTime) {
        try {
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
            // Degrade gracefully: continue with DB update so user sees scheduled time
            // Adapter already records schedulingError in DB when possible
          } else {
            scheduledInAwsBeforeUpdate = true;
            console.log(`AWS new schedule created for content ${contentId}`);
          }
        } catch (preScheduleError) {
          console.error('Error during AWS new schedule (pre-DB update):', preScheduleError);
          // Degrade gracefully: continue with DB update
        }
      }

      // Check if this is a reschedule operation (time changed)
      // Skip AWS operations if content belongs to a draft campaign
      let needsNewSchedule = false;
      if (!isInDraftCampaign && originalScheduledTime && newScheduledTime) {
        try {
          console.log(
            `Attempting to reschedule content ${contentId} from ${originalScheduledTime} to ${newScheduledTime}`
          );

          // Call AWS reschedule FIRST - fail fast if this doesn't work
          const rescheduleResult = await schedulerService.reschedulePost(
            contentId,
            updateData.scheduledAt!
          );

          if (!rescheduleResult.success) {
            console.error('AWS reschedule failed:', rescheduleResult.error);

            // Check if reschedule failed because content was never scheduled
            // In this case, we'll create a new schedule instead of erroring
            if (
              rescheduleResult.error?.toLowerCase().includes('not scheduled') ||
              rescheduleResult.error?.toLowerCase().includes('content is not scheduled') ||
              rescheduleResult.error?.toLowerCase().includes('not found') ||
              rescheduleResult.error?.toLowerCase().includes('missing') ||
              rescheduleResult.error?.toLowerCase().includes('does not exist')
            ) {
              console.log(
                `Content ${contentId} was never scheduled in AWS - will create new schedule instead`
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
            console.log(`AWS reschedule succeeded for content ${contentId}`);
          }
        } catch (rescheduleError) {
          console.error('Error during AWS reschedule:', rescheduleError);
          return reply.code(500).send({
            success: false,
            error: `Reschedule failed: ${rescheduleError instanceof Error ? rescheduleError.message : 'Unknown error'}`,
            data: null,
          });
        }
      }

      // Only update local DB after AWS operations succeed (or if no AWS operation needed)
      const updatedContent = await prisma.content.update({
        where: { id: contentId },
        data: updateData as unknown as Prisma.ContentUpdateInput,
        select: {
          id: true,
          caption: true,
          hashtags: true,
          s3ImageKey: true,
          status: true,
          scheduledAt: true,
          postedAt: true,
          createdAt: true,
          updatedAt: true,
          brandId: true,
        },
      });

      // Log the result for debugging
      console.log(
        'Content update result:',
        JSON.stringify({
          contentId: updatedContent.id,
          newScheduledAt: updatedContent.scheduledAt,
          newStatus: updatedContent.status,
          updateSuccessful: true,
        })
      );

      // Handle scheduling changes with AWS ContentScheduler
      // Skip AWS operations if content belongs to a draft campaign
      if (scheduledAt !== undefined && !isInDraftCampaign && !scheduledInAwsBeforeUpdate) {
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
            // Degrade gracefully: do not fail the request
          }
        }
        // Case 2: Cancel schedule (was scheduled, now isn't)
        else if (originalScheduledTime && !newScheduledTime) {
          try {
            const cancelResult = await schedulerService.cancelScheduledPost(contentId);

            if (cancelResult) {
              console.log(`Schedule for content ${contentId} cancelled successfully`);
            } else {
              console.error('Failed to cancel AWS schedule for content:', contentId);
            }
          } catch (cancelError) {
            console.error('Error cancelling schedule:', cancelError);
          }
        }
        // Note: Reschedule logic moved earlier in the flow to prevent race conditions
        // AWS operations now happen BEFORE local DB updates
      } else if (scheduledAt !== undefined && isInDraftCampaign) {
        console.log(
          `Skipping AWS scheduling operations for content ${contentId} - belongs to draft campaign ${content.campaign?.id}`
        );
      }

      // Apply AI learning if there were changes
      let learningResults = null;
      const hasChanges =
        (caption !== undefined && caption !== originalContent.caption) ||
        (hashtags !== undefined &&
          JSON.stringify(hashtags) !== JSON.stringify(originalContent.hashtags)) ||
        (scheduledAt !== undefined && scheduledAt !== originalContent.scheduledAt);

      if (hasChanges) {
        try {
          const editedContent: {
            caption: string;
            hashtags: string[];
            scheduledAt?: string;
          } = {
            caption: updatedContent.caption,
            hashtags: updatedContent.hashtags,
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
                console.log(
                  `Learning applied for brand ${content.brand.id}:`,
                  JSON.stringify({
                    insights: results.insights.length,
                    profileUpdates: results.profileUpdates.length,
                    appliedToFuturePosts: results.appliedToFuturePosts,
                  })
                );
              })
              .catch((error) => {
                console.error('Learning application error:', error);
              });

            // Provide immediate feedback about learning
            learningResults = {
              learningActive: true,
              message: 'AI is learning from your edits...',
            };
          }
        } catch (error) {
          console.error('Learning analysis error:', error);
        }
      }

      // Build CDN URL from S3 key and map to public response format
      const contentWithUrl = buildContentResponse(updatedContent);

      return {
        content: contentWithUrl,
        learning: learningResults,
        ...(planLimitHit ? { upsell: { upgradeRequired: true, message: planLimitMessage } } : {}),
      };
    } catch (error) {
      console.error('Content update error:', error);
      return reply.code(500).send({ error: 'Failed to update content' });
    }
  });

  // Schedule content (RESTful: POST /:contentId/schedule)
  fastify.post<{ Params: { contentId: string }; Body: { scheduledAt?: string } }>(
    '/:contentId/schedule',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const payload = {
        contentId: request.params.contentId,
        scheduledAt: request.body?.scheduledAt,
      } as UpdateContentBody;
      const r = await fastify.inject({
        method: 'PUT',
        url: '/update',
        payload,
        headers: { cookie: request.headers.cookie as string },
      });
      return reply.code(r.statusCode).send(r.json());
    }
  );
};

export default updatesRoutes;
