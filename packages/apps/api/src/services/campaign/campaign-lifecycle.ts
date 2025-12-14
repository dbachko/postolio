import { CampaignStatus, Prisma } from '@postolio/database';
import { TimezoneService } from '../timezone.js';
import { DEFAULT_TIMEZONE } from '../../constants/timezone.js';
import { schedulerService } from '../scheduler.js';
import { eventEmitter } from '../event-emitter.js';
import { getDatabaseClient } from '../../config/database.js';
import { logger as baseLogger } from '@postolio/logger';
import { APIError } from '@postolio/errors';
import { SCHEDULING_BUFFER_MS } from './campaign-constants.js';
import type { CampaignStartResult } from './campaign-types.js';

const prisma = getDatabaseClient();
const logger = baseLogger.child({ module: 'campaign-lifecycle-service' });

type CampaignWithContent = Record<string, unknown>;

export class CampaignLifecycleService {
  /**
   * Start campaign - generate all content and schedule posts
   */
  async startCampaign(campaignId: string, userId: string): Promise<CampaignStartResult> {
    try {
      // Get campaign and validate
      const campaign = await prisma.campaign.findFirst({
        where: {
          id: campaignId,
          brand: {
            userId,
          },
          status: 'preview',
        },
        include: {
          brand: {
            select: {
              id: true,
              name: true,
              // styleProfile no longer required for generation
              styleProfile: true,
            },
          },
        },
      });

      if (!campaign) {
        throw new APIError(
          'Campaign not found, access denied, or not ready for launch',
          'CAMPAIGN_NOT_FOUND',
          404,
          { campaignId, userId }
        );
      }

      const rawCfg = (campaign.config ?? {}) as unknown;
      const config =
        rawCfg && typeof rawCfg === 'object'
          ? (rawCfg as {
              duration?: { start?: string; end?: string };
              frequency?: string;
              postingTime?: string;
              themes?: string[];
              style?: string;
            })
          : {};

      // Generate posting schedule (now timezone-aware)
      if (
        !config.duration?.start ||
        !config.duration?.end ||
        !config.frequency ||
        !config.postingTime
      ) {
        throw new APIError(
          'Campaign configuration incomplete. Regenerate preview.',
          'CAMPAIGN_CONFIG_INCOMPLETE',
          400,
          { campaignId }
        );
      }
      const postDates = await this.generatePostingSchedule(
        new Date(config.duration.start),
        new Date(config.duration.end),
        config.frequency,
        config.postingTime,
        campaign.brandId
      );

      // Get existing preview posts for this campaign
      const existingPreviews = await prisma.content.findMany({
        where: {
          campaignId: campaignId,
          scheduledAt: null, // Preview posts don't have scheduled dates yet
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      const createdContent = [];

      // Only schedule existing preview posts (no new content generation)
      if (existingPreviews.length === 0) {
        throw new APIError(
          'No preview posts found. Please generate campaign preview first.',
          'CAMPAIGN_NO_PREVIEW',
          400,
          { campaignId }
        );
      }

      logger.info('Scheduling preview posts for campaign', {
        campaignId: campaign.id,
        brandId: campaign.brandId,
        previewCount: existingPreviews.length,
      });

      logger.info('Scheduling timezone for campaign start', {
        campaignId: campaign.id,
        brandId: campaign.brandId,
        timezone: await TimezoneService.getBrandTimezone(campaign.brandId),
      });

      // Schedule existing preview posts only
      for (let i = 0; i < Math.min(existingPreviews.length, postDates.length); i++) {
        const scheduledDate = postDates[i];
        const existingPost = existingPreviews[i];

        if (!existingPost) continue;

        // Check if we have a valid scheduled date
        const hasValidScheduledDate = scheduledDate !== null && scheduledDate !== undefined;

        // Always update content with campaign metadata and scheduling info, but keep as draft
        const operationId = `campaign-start-${campaignId}-${i}`;

        const content = await prisma.content.update({
          where: { id: existingPost.id },
          data: {
            status: 'draft', // Keep as draft until AWS sync confirms scheduling
            scheduledAt: hasValidScheduledDate ? scheduledDate : null,
            generationParams: {
              ...((existingPost?.generationParams as Record<string, unknown>) || {}),
              campaignGenerated: true,
              isPreview: false, // No longer a preview
              scheduledAt: hasValidScheduledDate ? scheduledDate?.toISOString() : undefined,
              // Set processing state to indicate scheduling is in progress
              processing: hasValidScheduledDate
                ? {
                    active: true,
                    operation: 'scheduling',
                    startedAt: new Date().toISOString(),
                    operationId: operationId,
                  }
                : null,
            },
          },
        });

        // Trigger AWS scheduling in background if we have a valid date
        if (hasValidScheduledDate && scheduledDate) {
          this.scheduleContentInBackground(
            existingPost.id,
            content.generationParams,
            operationId,
            campaign.id
          );
        }

        createdContent.push(content);
      }

      // Log successful scheduling
      logger.info('Successfully scheduled posts for campaign', {
        campaignId: campaign.id,
        scheduledPosts: createdContent.length,
      });

      if (existingPreviews.length < postDates.length) {
        logger.warn(
          'Campaign has more planned posts than preview posts; rolling generation will create additional content as needed',
          {
            campaignId: campaign.id,
            plannedPosts: postDates.length,
            previewPosts: existingPreviews.length,
          }
        );
      }

      // Update campaign status
      const updatedCampaign = await prisma.campaign.update({
        where: { id: campaignId },
        data: {
          status: 'active',
          startedAt: new Date(),
        },
      });

      // 🔥 CRITICAL: Emit campaign created event for microservices
      eventEmitter.emitCampaignCreated(campaignId, campaign.brandId, 'active', {
        userId,
        operation: 'campaign.start',
      });

      return {
        campaign: updatedCampaign,
        scheduledPosts: createdContent.length,
      };
    } catch (error) {
      logger.error('Campaign start error', { campaignId, userId, error });
      throw error instanceof APIError
        ? error
        : new APIError(
            error instanceof Error ? error.message : 'Failed to start campaign',
            'CAMPAIGN_START_FAILED',
            500,
            { campaignId, userId }
          );
    }
  }

  async pauseCampaign(campaignId: string, userId: string): Promise<CampaignWithContent> {
    try {
      const result = await prisma.$transaction(async (tx) => {
        // Verify ownership and get current status inside transaction
        const campaign = await tx.campaign.findFirst({
          where: {
            id: campaignId,
            brand: { userId },
          },
        });

        if (!campaign) {
          throw new APIError('Campaign not found or access denied', 'CAMPAIGN_NOT_FOUND', 404, {
            campaignId,
            userId,
          });
        }

        // Validate status transition inside transaction
        const validTransitions = this.getValidStatusTransitions();
        const allowedTransitions = validTransitions[campaign.status] || [];

        if (!allowedTransitions.includes('paused')) {
          throw new APIError(
            `Invalid status transition: ${campaign.status} → paused. Allowed transitions: ${allowedTransitions.join(', ')}`,
            'CAMPAIGN_INVALID_STATUS',
            400,
            {
              campaignId,
              userId,
              currentStatus: campaign.status,
              attemptedStatus: 'paused',
            }
          );
        }

        const previousStatus = campaign.status;

        // Update campaign status to paused
        const updatedCampaign = await tx.campaign.update({
          where: { id: campaignId },
          data: { status: 'paused' },
        });

        // Mark all future scheduled content as skipped (preserving scheduledAt for resume)
        const skippedContent = await tx.content.updateMany({
          where: {
            campaignId,
            status: 'scheduled', // Content currently scheduled
            scheduledAt: {
              gte: new Date(), // In the future
            },
          },
          data: {
            status: 'skipped', // Mark as skipped (NOT draft!)
            // Keep scheduledAt intact so we can restore it on resume
            schedulingError: 'Skipped: Campaign was paused',
          },
        });

        logger.info('Campaign paused and scheduled posts marked as skipped', {
          campaignId,
          userId,
          skippedCount: skippedContent.count,
        });

        return {
          campaign: updatedCampaign,
          cancelledCount: skippedContent.count,
          oldStatus: previousStatus,
          message: 'Campaign paused. No content will be published until resumed.',
        };
      });

      // Notify downstream systems (Dynamo sync, scheduler) about the pause
      if (result?.campaign && result.oldStatus) {
        eventEmitter.emitCampaignStatusChanged(
          campaignId,
          result.campaign.brandId as string,
          result.oldStatus,
          'paused',
          {
            userId,
            operation: 'campaign.pause',
          }
        );
      }

      return result;
    } catch (error) {
      logger.error('Pause campaign error', { campaignId, userId, error });
      throw error;
    }
  }

  async resumeCampaign(campaignId: string, userId: string): Promise<CampaignWithContent> {
    try {
      const result = await prisma.$transaction(async (tx) => {
        // Verify ownership and get current status inside transaction
        const campaign = await tx.campaign.findFirst({
          where: {
            id: campaignId,
            brand: { userId },
          },
        });

        if (!campaign) {
          throw new APIError('Campaign not found or access denied', 'CAMPAIGN_NOT_FOUND', 404, {
            campaignId,
            userId,
          });
        }

        // Validate status transition inside transaction
        const validTransitions = this.getValidStatusTransitions();
        const allowedTransitions = validTransitions[campaign.status] || [];

        if (!allowedTransitions.includes('active')) {
          throw new APIError(
            `Invalid status transition: ${campaign.status} → active. Allowed transitions: ${allowedTransitions.join(', ')}`,
            'CAMPAIGN_INVALID_STATUS',
            400,
            {
              campaignId,
              userId,
              currentStatus: campaign.status,
              attemptedStatus: 'active',
            }
          );
        }

        const now = new Date();
        const previousStatus = campaign.status;
        const rawConfig = campaign.config as unknown;
        const config =
          rawConfig && typeof rawConfig === 'object'
            ? (rawConfig as { duration?: { end?: string | Date } })
            : {};
        const campaignEndDate = new Date(config.duration?.end || now);

        // Auto-complete if campaign expired
        if (campaignEndDate < now) {
          const completedCampaign = await tx.campaign.update({
            where: { id: campaignId },
            data: {
              status: 'completed',
              completedAt: now,
            },
          });

          return {
            campaign: completedCampaign,
            skippedCount: 0,
            oldStatus: previousStatus,
            message: 'Campaign auto-completed (end date has passed)',
          };
        }

        // Restore skipped content with future dates back to scheduled
        const restoredContent = await tx.content.updateMany({
          where: {
            campaignId,
            status: 'skipped', // Content that was skipped during pause
            scheduledAt: {
              gte: now, // Still in the future - can be rescheduled
            },
          },
          data: {
            status: 'scheduled', // Restore to scheduled status
            schedulingError: null, // Clear the error message
          },
        });

        // Handle skipped content with past dates (permanently missed)
        const permanentlySkipped = await tx.content.updateMany({
          where: {
            campaignId,
            status: 'skipped', // Content that was skipped
            scheduledAt: {
              lt: now, // In the past - permanently missed
            },
          },
          data: {
            schedulingError: 'Permanently skipped: Scheduled time passed during pause',
          },
        });

        // Resume campaign
        const updatedCampaign = await tx.campaign.update({
          where: { id: campaignId },
          data: { status: 'active' },
        });

        logger.info('Campaign resumed with content status updates', {
          campaignId,
          userId,
          restoredCount: restoredContent.count,
          permanentlySkippedCount: permanentlySkipped.count,
        });

        return {
          campaign: updatedCampaign,
          restoredCount: restoredContent.count,
          permanentlySkippedCount: permanentlySkipped.count,
          oldStatus: previousStatus,
          message:
            restoredContent.count > 0
              ? `Campaign resumed. ${restoredContent.count} posts restored to schedule.${permanentlySkipped.count > 0 ? ` ${permanentlySkipped.count} posts permanently skipped.` : ''}`
              : permanentlySkipped.count > 0
                ? `Campaign resumed. ${permanentlySkipped.count} posts were permanently skipped.`
                : 'Campaign resumed successfully!',
        };
      });

      // Notify downstream systems (Dynamo sync, scheduler) about the resume/complete transition
      if (result?.campaign && result.oldStatus) {
        eventEmitter.emitCampaignStatusChanged(
          campaignId,
          result.campaign.brandId as string,
          result.oldStatus,
          result.campaign.status as string,
          {
            userId,
            operation: 'campaign.resume',
          }
        );
      }

      return result;
    } catch (error) {
      logger.error('Resume campaign error', { campaignId, userId, error });
      throw error;
    }
  }

  /**
   * Update campaign status with validation (for non-pause/resume operations)
   */
  async updateCampaignStatus(
    campaignId: string,
    userId: string,
    newStatus: string
  ): Promise<{
    success: boolean;
    campaign: CampaignWithContent | null;
    oldStatus?: string;
    message: string;
  }> {
    try {
      const result = await prisma.$transaction(async (tx) => {
        // Verify ownership and get current status inside transaction
        const campaign = await tx.campaign.findFirst({
          where: {
            id: campaignId,
            brand: { userId },
          },
        });

        if (!campaign) {
          throw new APIError('Campaign not found or access denied', 'CAMPAIGN_NOT_FOUND', 404, {
            campaignId,
            userId,
          });
        }

        // Validate status transition inside transaction
        const validTransitions = this.getValidStatusTransitions();
        const allowedTransitions = validTransitions[campaign.status] || [];

        if (!allowedTransitions.includes(newStatus)) {
          throw new APIError(
            `Invalid status transition: ${campaign.status} → ${newStatus}. Allowed transitions: ${allowedTransitions.join(', ')}`,
            'CAMPAIGN_INVALID_STATUS',
            400,
            {
              campaignId,
              userId,
              currentStatus: campaign.status,
              attemptedStatus: newStatus,
            }
          );
        }

        // Update campaign status
        const updatedCampaign = await tx.campaign.update({
          where: { id: campaignId },
          data: {
            status: newStatus as CampaignStatus,
            ...(newStatus === 'completed' ? { completedAt: new Date() } : {}),
          },
        });

        logger.info('Campaign status updated', {
          campaignId,
          userId,
          oldStatus: campaign.status,
          newStatus,
        });

        return {
          success: true,
          campaign: updatedCampaign as unknown as CampaignWithContent,
          oldStatus: campaign.status as string,
          message: `Campaign status updated to ${newStatus}`,
        };
      });

      // 🔔 CRITICAL: Emit campaign status changed event for microservices
      if (result.success && result.campaign && result.oldStatus) {
        const campaign = result.campaign;
        eventEmitter.emitCampaignStatusChanged(
          campaignId,
          campaign.brandId as string,
          result.oldStatus,
          newStatus,
          {
            userId,
            operation: 'campaign.status.update',
          }
        );
      }

      return result;
    } catch (error) {
      logger.error('Update campaign status error', { campaignId, userId, error, newStatus });
      throw error;
    }
  }

  /**
   * Get valid status transitions for campaigns
   */
  private getValidStatusTransitions(): Record<string, string[]> {
    return {
      creating: ['preview', 'failed'],
      preview: ['active', 'failed'],
      active: ['paused', 'completed', 'failed'],
      paused: ['active', 'completed', 'failed'],
      completed: [], // Terminal state
      failed: ['preview'], // Can retry from preview
      processing: ['active', 'failed'], // Background processing state
    };
  }

  /**
   * Generate posting schedule based on frequency and duration
   * Now timezone-aware: schedules in the brand's timezone
   */
  private async generatePostingSchedule(
    startDate: Date,
    endDate: Date,
    frequency: string,
    postingTime: string,
    brandId?: string
  ): Promise<Date[]> {
    const schedule: Date[] = [];
    const [hours, minutes] = postingTime.split(':').map(Number);

    // Get the appropriate timezone for this brand
    const timezone = brandId ? await TimezoneService.getBrandTimezone(brandId) : DEFAULT_TIMEZONE;

    const current = new Date(startDate);
    const now = new Date();

    while (current <= endDate) {
      const dateString = new Date(current.getFullYear(), current.getMonth(), current.getDate())
        .toISOString()
        .split('T')[0]!;

      // Create the scheduled time in the brand's timezone
      // Use TimezoneService.createDateInBrandTimezone to properly handle timezone
      const scheduledTime = TimezoneService.createDateInBrandTimezone(
        dateString,
        `${String(hours ?? 10).padStart(2, '0')}:${String(minutes ?? 0).padStart(2, '0')}`,
        timezone
      );

      // Skip times that are in the past (with a 5-minute buffer for processing time)
      const bufferTime = new Date(now.getTime() + SCHEDULING_BUFFER_MS);
      if (scheduledTime > bufferTime) {
        schedule.push(scheduledTime);
      } else {
        logger.debug('Skipping past/too-soon scheduling time for campaign posting schedule', {
          scheduledTime: scheduledTime.toISOString(),
          bufferTime: bufferTime.toISOString(),
          brandId,
        });
      }

      // Increment based on frequency
      switch (frequency) {
        case 'daily':
          current.setDate(current.getDate() + 1);
          break;
        case 'every2days':
          current.setDate(current.getDate() + 2);
          break;
        case '3weekly': {
          // Post every 2-3 days (Monday, Wednesday, Friday pattern)
          const dayOfWeek = current.getDay();
          if (dayOfWeek === 1) {
            // Monday -> Wednesday
            current.setDate(current.getDate() + 2);
          } else if (dayOfWeek === 3) {
            // Wednesday -> Friday
            current.setDate(current.getDate() + 2);
          } else {
            // Friday -> Monday
            current.setDate(current.getDate() + 3);
          }
          break;
        }
        default:
          current.setDate(current.getDate() + 7);
      }
    }

    return schedule;
  }

  /**
   * Kick off AWS scheduling without blocking the HTTP response.
   */
  private scheduleContentInBackground(
    contentId: string,
    generationParams: Prisma.JsonValue | null | undefined,
    operationId: string,
    campaignId: string
  ): void {
    (async () => {
      try {
        const scheduleResult = await schedulerService.scheduleContent(contentId);

        if (scheduleResult.success) {
          logger.info('Content scheduling initiated in AWS', {
            contentId,
            campaignId,
            operationId,
          });
          return;
        }

        logger.error('Failed to create AWS schedule for content', {
          contentId,
          campaignId,
          operationId,
          error: scheduleResult.error,
        });
        await this.applySchedulingError(
          contentId,
          generationParams,
          scheduleResult.error || 'Unknown error'
        );
      } catch (error) {
        logger.error('Error scheduling content', {
          contentId,
          campaignId,
          operationId,
          error,
        });
        await this.applySchedulingError(
          contentId,
          generationParams,
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    })().catch((fatalError) => {
      logger.error('Fatal scheduling error for content', {
        contentId,
        campaignId,
        operationId,
        error: fatalError,
      });
    });
  }

  private async applySchedulingError(
    contentId: string,
    baseParams: Prisma.JsonValue | null | undefined,
    errorMessage: string
  ): Promise<void> {
    const params: Record<string, unknown> =
      baseParams && typeof baseParams === 'object' && !Array.isArray(baseParams)
        ? { ...(baseParams as Record<string, unknown>) }
        : {};

    params.processing = null;
    params.schedulingError = `AWS scheduling failed: ${errorMessage}`;

    await prisma.content.update({
      where: { id: contentId },
      data: {
        generationParams: params as Prisma.InputJsonValue,
      },
    });
  }
}

export const campaignLifecycleService = new CampaignLifecycleService();
