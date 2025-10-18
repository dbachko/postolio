import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@postolio/database';

import {
  generateInstagramContent,
  type ContentGenerationRequest,
} from '../services/content-generator.js';
import learningService from '../services/learning.js';
import { uploadImageBufferToS3, buildCdnUrl, type ImageMetadata } from '../services/s3-image.js';
import { computePlaceholders } from '../services/placeholderService.js';
import { schedulerService } from '../services/scheduler.js';

import { getDatabaseClient } from '../config/database.js';
import { getOrCreateDefaultCampaign } from '../services/default-campaign.js';

const prisma = getDatabaseClient();

/**
 * Normalize hashtags by stripping # symbols
 * This ensures consistency across manual and AI-generated content
 */
function normalizeHashtags(hashtags: string[]): string[] {
  return hashtags.map((tag) => tag.replace(/^#+/, '').trim()).filter((tag) => tag.length > 0);
}

type GenerateContentBody = ContentGenerationRequest;

interface ApproveContentBody {
  contentId: string;
  scheduledAt?: string;
}

interface CreateManualContentBody {
  brandId: string;
  caption: string;
  hashtags: string[];
  imageData?: string;
  mimeType?: string;
  campaignId?: string;
  scheduledAt?: string;
}

interface UpdateContentBody {
  contentId: string;
  caption?: string;
  hashtags?: string[];
  scheduledAt?: string;
}

const contentRoutes: FastifyPluginAsync = async (fastify) => {
  // Generate content for a brand
  fastify.post<{ Body: GenerateContentBody }>(
    '/generate',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;

        const { brandId, count, theme, style } = request.body;

        // Verify user owns the brand
        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId,
          },
          select: {
            id: true,
            name: true,
            styleProfile: true,
          },
        });

        if (!brand) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        // Brand analysis profile is now read from the projection table by the generator

        // Generate content using AI (brand profile projection)
        const generatedContent = await generateInstagramContent(brand.name, {
          brandId,
          count,
          theme: theme || undefined,
          style: style || undefined,
        });

        // Save generated content to database
        // Resolve default campaign id to attach generated posts
        const defaultCampaign = await getOrCreateDefaultCampaign(brandId);

        const contentRecords = await Promise.all(
          generatedContent.map(async (content) => {
            // Validate content before saving
            if (!content.caption || content.caption.trim().length === 0) {
              console.error('Generated content has empty caption:', content);
              throw new Error('Generated content has empty caption');
            }
            if (!content.hashtags || !Array.isArray(content.hashtags)) {
              console.error('Generated content has invalid hashtags:', content);
              throw new Error('Generated content has invalid hashtags');
            }

            return prisma.content.create({
              data: {
                caption: content.caption,
                hashtags: content.hashtags,
                s3ImageKey: content.s3ImageKey || null,
                imageRegion: content.imageRegion || null,
                retentionExpiresAt: content.retentionExpiresAt || null,
                status: 'draft',
                brandId,
                campaignId: defaultCampaign.id,
                generationParams: JSON.parse(
                  JSON.stringify({
                    theme,
                    style,
                    imagePrompt: content.imagePrompt,
                    generatedAt: new Date().toISOString(),
                  })
                ),
              },
              select: {
                id: true,
                caption: true,
                hashtags: true,
                s3ImageKey: true,
                imageRegion: true,
                retentionExpiresAt: true,
                status: true,
                createdAt: true,
              },
            });
          })
        );

        // Build CDN URLs from S3 keys and map to public response format
        const contentWithUrls = contentRecords.map((item) => ({
          id: item.id,
          caption: item.caption,
          hashtags: item.hashtags,
          imageUrl: buildCdnUrl(item.s3ImageKey),
          status: item.status,
          createdAt: item.createdAt,
        }));

        return reply.code(201).send({
          content: contentWithUrls,
          metadata: {
            brandId,
            count: contentRecords.length,
            theme,
            style,
          },
        });
      } catch (error) {
        console.error('Content generation error:', error);

        // Handle specific OpenAI errors with appropriate status codes
        if (error instanceof Error) {
          if (error.message.includes('OpenAI API key configuration error')) {
            return reply.code(503).send({
              error: 'AI service configuration error. Please contact support.',
            });
          }
          if (error.message.includes('OpenAI API quota exceeded')) {
            return reply.code(503).send({
              error: 'AI service quota exceeded. Please try again later.',
            });
          }
          if (error.message.includes('OpenAI API rate limit exceeded')) {
            return reply.code(429).send({
              error: 'AI service rate limit exceeded. Please try again in a moment.',
            });
          }
        }

        return reply.code(500).send({ error: 'Failed to generate content. Please try again.' });
      }
    }
  );

  // Create manual content (user-generated, not AI)
  fastify.post<{ Body: CreateManualContentBody }>(
    '/create',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;

        const { brandId, caption, hashtags, imageData, campaignId, scheduledAt } = request.body;

        // Validate input
        if (!caption || caption.trim().length === 0) {
          return reply.code(400).send({ error: 'Caption is required' });
        }

        if (caption.length > 2200) {
          return reply.code(400).send({
            error: 'Caption exceeds Instagram limit of 2200 characters',
          });
        }

        if (!Array.isArray(hashtags)) {
          return reply.code(400).send({ error: 'Hashtags must be an array' });
        }

        if (hashtags.length > 30) {
          return reply.code(400).send({ error: 'Maximum 30 hashtags allowed' });
        }

        // Normalize hashtags (strip # symbols for consistency)
        const normalizedHashtags = normalizeHashtags(hashtags);

        // Verify user owns the brand
        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId,
          },
          select: {
            id: true,
            name: true,
          },
        });

        if (!brand) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        let s3ImageKey: string | null = null;
        let imageRegion: string | null = null;
        let retentionExpiresAt: Date | null = null;

        // Handle image upload if provided
        if (imageData) {
          try {
            // Extract base64 data
            const base64Match = imageData.match(/^data:([^;]+);base64,(.+)$/);
            if (!base64Match || !base64Match[2]) {
              return reply.code(400).send({ error: 'Invalid image data format' });
            }

            const buffer = Buffer.from(base64Match[2], 'base64');

            // Upload to S3
            const uploadResult = await uploadImageBufferToS3(buffer, {
              contentId: `manual-${Date.now()}-${Math.random().toString(36).substring(7)}`,
              brandId,
              generatedAt: new Date(),
              source: 'dalle3' as const, // Use dalle3 as placeholder for manual uploads
              originalPrompt: '',
            });

            s3ImageKey = uploadResult.s3Key;
            imageRegion = uploadResult.region;
            retentionExpiresAt = uploadResult.retentionExpiresAt;
          } catch (uploadError) {
            console.error('Image upload error:', uploadError);
            // Continue without image rather than failing entirely
          }
        }

        // Validate campaignId if provided
        if (campaignId) {
          const campaign = await prisma.campaign.findFirst({
            where: {
              id: campaignId,
              brandId,
            },
          });

          if (!campaign) {
            return reply
              .code(400)
              .send({ error: 'Campaign not found or does not belong to this brand' });
          }
        }

        // Determine status based on scheduledAt
        const status = scheduledAt ? 'scheduled' : 'draft';

        // Resolve default campaign if one is not provided
        const resolvedCampaignId = campaignId || (await getOrCreateDefaultCampaign(brandId)).id;

        // Create content record
        const content = await prisma.content.create({
          data: {
            caption,
            hashtags: normalizedHashtags,
            s3ImageKey,
            imageRegion,
            retentionExpiresAt,
            status,
            brandId,
            campaignId: resolvedCampaignId,
            scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
            generationParams: Prisma.JsonNull, // null indicates manual creation
          },
          select: {
            id: true,
            caption: true,
            hashtags: true,
            s3ImageKey: true,
            imageRegion: true,
            retentionExpiresAt: true,
            status: true,
            brandId: true,
            generationParams: true,
            createdAt: true,
          },
        });

        // If scheduled time is provided, create AWS schedule
        if (scheduledAt) {
          try {
            const scheduleResult = await schedulerService.scheduleContent(content.id);

            if (!scheduleResult.success) {
              console.error('Failed to create AWS schedule:', scheduleResult.error);
              // Note: We don't fail the request as the content is already created locally
            } else {
              console.log(`Content ${content.id} scheduled successfully in AWS`);
            }
          } catch (scheduleError) {
            console.error('Error calling scheduler service:', scheduleError);
            // Continue - content is created, scheduling failure is non-critical
          }
        }

        // Build CDN URL from S3 key and map to public response format
        const contentWithUrl = {
          id: content.id,
          caption: content.caption,
          hashtags: content.hashtags,
          imageUrl: buildCdnUrl(content.s3ImageKey),
          status: content.status,
          brandId: content.brandId,
          generationParams: content.generationParams,
          createdAt: content.createdAt,
        };

        return reply.code(201).send({
          content: contentWithUrl,
          metadata: {
            brandId,
            source: 'manual',
          },
        });
      } catch (error) {
        console.error('Manual content creation error:', error);
        return reply.code(500).send({ error: 'Failed to create content' });
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
        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId,
          },
        });

        if (!brand) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        const draftContent = await prisma.content.findMany({
          where: {
            brandId,
            status: 'draft',
          },
          select: {
            id: true,
            caption: true,
            hashtags: true,
            s3ImageKey: true,
            imageRegion: true,
            status: true,
            createdAt: true,
            generationParams: true,
          },
          orderBy: { createdAt: 'desc' },
        });

        // Build CDN URLs from S3 keys and map to public response format
        const contentWithUrls = draftContent.map((item) => ({
          id: item.id,
          caption: item.caption,
          hashtags: item.hashtags,
          imageUrl: buildCdnUrl(item.s3ImageKey),
          status: item.status,
          createdAt: item.createdAt,
          generationParams: item.generationParams,
        }));

        return { content: contentWithUrls };
      } catch (error) {
        console.error('Draft content error:', error);
        return reply.code(500).send({ error: 'Failed to retrieve draft content' });
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

        // Verify user owns the content through brand ownership and get campaign info
        const content = await prisma.content.findFirst({
          where: { id: contentId },
          include: {
            brand: {
              select: { userId: true },
            },
            campaign: {
              select: { id: true, status: true },
            },
          },
        });

        if (!content || content.brand.userId !== userId) {
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
            hashtags: true,
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
            console.log(
              `Content ${contentId} belongs to campaign ${content.campaign?.id} in preview state - updating database only, not scheduling in AWS`
            );
          } else {
            try {
              // Don't pass customTime - let scheduler-adapter read scheduledAt from database
              // This avoids timezone conversion issues since DB stores UTC
              const scheduleResult = await schedulerService.scheduleContent(contentId);

              if (!scheduleResult.success) {
                console.error('Failed to create AWS schedule:', scheduleResult.error);
                // Note: We don't fail the request here as the content is already scheduled locally
                // The scheduler adapter has fallback logic
              } else {
                console.log(`Content ${contentId} scheduled successfully in AWS`);
              }
            } catch (scheduleError) {
              console.error('Error calling scheduler service:', scheduleError);
              // Continue with local scheduling
            }
          }
        }

        return { content: updatedContent };
      } catch (error) {
        console.error('Content approval error:', error);
        return reply.code(500).send({ error: 'Failed to approve content' });
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
        const content = await prisma.content.findFirst({
          where: { id: contentId },
          include: {
            brand: {
              select: { userId: true },
            },
          },
        });

        if (!content || content.brand.userId !== userId) {
          return reply.code(404).send({ error: 'Content not found' });
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
        console.error('Content rejection error:', error);
        return reply.code(500).send({ error: 'Failed to reject content' });
      }
    }
  );

  // Update content
  fastify.put<{ Body: UpdateContentBody }>(
    '/update',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;

        const { contentId, caption, hashtags, scheduledAt } = request.body;

        // Verify user owns the content through brand ownership and get campaign info
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

        if (!content || !content.brand || content.brand.userId !== userId) {
          return reply.code(404).send({ error: 'Content not found' });
        }

        // Prevent editing published content
        if (content.status === 'published') {
          return reply.code(400).send({
            error: 'Cannot edit published content. Published posts are immutable.',
          });
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
                captionLength: caption?.length || 0,
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
          } else if (!scheduledAt && content.status === 'scheduled') {
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
              } else if (
                rescheduleResult.error?.includes('AWS scheduler temporarily unavailable')
              ) {
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
        const contentWithUrl = {
          id: updatedContent.id,
          caption: updatedContent.caption,
          hashtags: updatedContent.hashtags,
          imageUrl: buildCdnUrl(updatedContent.s3ImageKey),
          status: updatedContent.status,
          scheduledAt: updatedContent.scheduledAt,
          postedAt: updatedContent.postedAt,
          createdAt: updatedContent.createdAt,
          updatedAt: updatedContent.updatedAt,
          brandId: updatedContent.brandId,
        };

        return {
          content: contentWithUrl,
          learning: learningResults,
        };
      } catch (error) {
        console.error('Content update error:', error);
        return reply.code(500).send({ error: 'Failed to update content' });
      }
    }
  );

  // Get content history
  fastify.get<{ Params: { brandId: string } }>(
    '/history/:brandId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;

        const { brandId } = request.params;

        // Verify user owns the brand
        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId,
          },
        });

        if (!brand) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        const contentHistory = await prisma.content.findMany({
          where: {
            brandId,
            status: {
              in: ['draft', 'scheduled', 'published', 'failed', 'skipped'],
            },
          },
          select: {
            id: true,
            caption: true,
            hashtags: true,
            s3ImageKey: true,
            imageRegion: true,
            retentionExpiresAt: true,
            status: true,
            scheduledAt: true,
            postedAt: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: 50, // Limit to last 50 items
        });

        // Build CDN URLs from S3 keys and map to public response format
        const historyWithUrls = contentHistory.map((item) => ({
          id: item.id,
          caption: item.caption,
          hashtags: item.hashtags,
          imageUrl: buildCdnUrl(item.s3ImageKey),
          status: item.status,
          scheduledAt: item.scheduledAt,
          postedAt: item.postedAt,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        }));

        return { content: historyWithUrls };
      } catch (error) {
        console.error('Content history error:', error);
        return reply.code(500).send({ error: 'Failed to retrieve content history' });
      }
    }
  );

  // Upload image for content
  fastify.post<{
    Body: {
      contentId: string;
      imageData: string; // Base64 encoded image data
      mimeType: string;
    };
  }>('/upload-image', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;

      const { contentId, imageData, mimeType } = request.body;

      // Validate input
      if (!contentId || !imageData || !mimeType) {
        return reply.code(400).send({ error: 'Missing required fields' });
      }

      // Validate mime type
      const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedMimeTypes.includes(mimeType)) {
        return reply.code(400).send({
          error: 'Invalid image type. Supported types: JPEG, PNG, WebP',
        });
      }

      // Verify user owns the content through brand ownership
      const content = await prisma.content.findFirst({
        where: { id: contentId },
        include: {
          brand: {
            select: { userId: true, id: true },
          },
        },
      });

      if (!content || content.brand.userId !== userId) {
        return reply.code(404).send({ error: 'Content not found' });
      }

      // Prevent editing published content
      if (content.status === 'published') {
        return reply.code(400).send({
          error: 'Cannot edit published content. Published posts are immutable.',
        });
      }

      try {
        // Convert base64 to buffer - validate size BEFORE creating buffer
        const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');

        // Calculate estimated size from base64 length
        // Base64 encoding represents every 3 bytes of binary data as 4 ASCII characters (4/3 ratio).
        // To estimate the original binary size, multiply the base64 string length by 3/4.
        const estimatedSize = (base64Data.length * 3) / 4;
        const maxSize = 10 * 1024 * 1024;

        if (estimatedSize > maxSize) {
          return reply.code(400).send({
            error: `Image size exceeds 10MB limit. Estimated size: ${(estimatedSize / (1024 * 1024)).toFixed(2)}MB`,
          });
        }

        // Now safe to create buffer
        const buffer = Buffer.from(base64Data, 'base64');

        // Double-check actual size
        if (buffer.length > maxSize) {
          return reply.code(400).send({ error: 'Image size exceeds 10MB limit' });
        }

        // Upload to S3
        let uploadResult = null;

        try {
          const metadata: ImageMetadata = {
            contentId: content.id,
            brandId: content.brand.id,
            campaignId: content.campaignId || undefined,
            generatedAt: new Date(),
            source: 'dalle3', // Mark as user upload (we use dalle3 as default)
            originalPrompt: 'User uploaded image',
          };

          console.log('Uploading user image to S3 for content:', contentId);
          console.log('Image buffer size:', buffer.length, 'bytes');
          console.log('MIME type:', mimeType);

          uploadResult = await uploadImageBufferToS3(buffer, metadata);

          console.log('Upload successful! S3 key:', uploadResult.s3Key);
        } catch (s3Error) {
          console.error('S3 upload failed:', s3Error);
          // Fail gracefully instead of storing large base64 data URLs
          return reply.code(500).send({
            error: 'Failed to upload image to storage. Please try again.',
          });
        }

        // Update content with S3 data
        const updateData: Record<string, unknown> = {
          s3ImageKey: uploadResult.s3Key,
          imageRegion: uploadResult.region,
          retentionExpiresAt: uploadResult.retentionExpiresAt,
        };

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
            createdAt: true,
            updatedAt: true,
          },
        });

        // Build CDN URL from S3 key and map to public response format
        const contentWithUrl = {
          id: updatedContent.id,
          caption: updatedContent.caption,
          hashtags: updatedContent.hashtags,
          imageUrl: buildCdnUrl(updatedContent.s3ImageKey),
          status: updatedContent.status,
          scheduledAt: updatedContent.scheduledAt,
          createdAt: updatedContent.createdAt,
          updatedAt: updatedContent.updatedAt,
        };

        return reply.send({
          success: true,
          content: contentWithUrl,
          message: 'Image uploaded successfully',
        });
      } catch (uploadError) {
        console.error('Image upload error:', uploadError);
        return reply.code(500).send({ error: 'Failed to upload image' });
      }
    } catch (error) {
      console.error('Upload image error:', error);
      return reply.code(500).send({ error: 'Failed to process image upload' });
    }
  });

  // Get calendar content with placeholders
  fastify.get<{
    Params: { brandId: string; month: string };
  }>('/calendar/:brandId/:month', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;

      const { brandId, month } = request.params;

      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: { id: brandId, userId },
      });

      if (!brand) {
        return reply.code(404).send({
          success: false,
          error: 'Brand not found',
        });
      }

      // Parse month string (format: YYYY-MM)
      const parts = month.split('-');
      if (parts.length !== 2) {
        return reply.code(400).send({ error: 'Invalid month format. Use YYYY-MM' });
      }

      const [yearStr, monthStr] = parts;
      if (!yearStr || !monthStr) {
        return reply.code(400).send({ error: 'Invalid month format. Use YYYY-MM' });
      }

      const year = parseInt(yearStr, 10);
      const monthNum = parseInt(monthStr, 10);

      if (isNaN(year) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
        return reply.code(400).send({ error: 'Invalid month format. Use YYYY-MM' });
      }

      const monthStart = new Date(year, monthNum - 1, 1);
      const monthEnd = new Date(year, monthNum, 0, 23, 59, 59);

      // Get existing content for the month
      const content = await prisma.content.findMany({
        where: {
          brandId,
          OR: [
            {
              scheduledAt: {
                gte: monthStart,
                lte: monthEnd,
              },
            },
            {
              postedAt: {
                gte: monthStart,
                lte: monthEnd,
              },
            },
          ],
        },
        orderBy: { scheduledAt: 'asc' },
      });

      // Get active campaigns
      const campaigns = await prisma.campaign.findMany({
        where: {
          brandId,
          status: { in: ['active', 'preview'] },
        },
      });

      // Compute placeholders (uses original content for type compatibility)
      const placeholders = computePlaceholders(campaigns, content, monthStart, monthEnd);

      // Build CDN URLs from S3 keys and map to public response format
      const contentWithUrls = content.map((item) => ({
        id: item.id,
        caption: item.caption,
        hashtags: item.hashtags,
        imageUrl: buildCdnUrl(item.s3ImageKey),
        status: item.status,
        scheduledAt: item.scheduledAt,
        postedAt: item.postedAt,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        brandId: item.brandId,
        campaignId: item.campaignId,
        instagramPostId: item.instagramPostId,
        instagramPermalink: item.instagramPermalink,
      }));

      return {
        success: true,
        data: {
          content: contentWithUrls,
          placeholders,
        },
      };
    } catch (error) {
      console.error('Calendar content error:', error);
      return reply.code(500).send({ error: 'Failed to retrieve calendar content' });
    }
  });
};

export default contentRoutes;
