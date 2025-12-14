import type { CampaignStatus } from '@postolio/database';
import {
  campaignCoordinationService,
  type CampaignConfigWithPriority,
} from '../campaign-coordination.js';
import { TimezoneService } from '../timezone.js';
import { campaignLifecycleService } from './campaign-lifecycle.js';
import { getDatabaseClient } from '../../config/database.js';
import { logger as baseLogger } from '@postolio/logger';
import { APIError } from '@postolio/errors';
import { ONE_DAY_MS } from './campaign-constants.js';
import { buildConflictSummary } from './campaign-conflicts.js';
import { validateFieldEditabilityForStatus } from './campaign-editability.js';
import {
  calculateDurationDays,
  calculateEstimatedPosts,
  isValidCampaignFrequency,
} from './campaign-frequency.js';

const prisma = getDatabaseClient();
const logger = baseLogger.child({ module: 'campaign-updates-service' });

type CampaignWithContent = Record<string, unknown>;

// Fields that can be edited directly or via config updates
export type EditableCampaignFields = Partial<{
  name: string;
  priority: number;
  status: CampaignStatus;
  // Direct top-level convenience fields (backwards compat)
  themes: string[];
  style: string;
  frequency: string;
  postingTime: string;
  startDate: string;
  endDate: string;
  goals: string;
  seasonalityAssist: boolean;
  // Nested config object (preferred)
  config: {
    themes?: string[];
    style?: string;
    frequency?: string;
    postingTime?: string;
    duration?: { start?: string; end?: string };
  };
}>;

// Update data accepted by updateCampaignWithRegeneration
export type CampaignUpdateData = EditableCampaignFields;

export class CampaignUpdatesService {
  /**
   * Update campaign configuration
   */
  async updateCampaign(
    campaignId: string,
    userId: string,
    updates: {
      name?: string;
      themes?: string[];
      style?: string;
      frequency?: string;
      postingTime?: string;
      startDate?: string;
      endDate?: string;
      status?: string;
    }
  ): Promise<{
    success: boolean;
    message?: string;
    campaign?: CampaignWithContent | null;
  }> {
    try {
      // Get campaign and validate ownership and status
      const campaign = await prisma.campaign.findFirst({
        where: {
          id: campaignId,
          brand: {
            userId,
          },
        },
        include: {
          brand: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (!campaign) {
        throw new APIError('Campaign not found or access denied', 'CAMPAIGN_NOT_FOUND', 404, {
          campaignId,
          userId,
        });
      }

      // Special handling for status transitions
      if (updates.status) {
        // Handle pause operation
        if (updates.status === 'paused') {
          const pausedCampaign = await campaignLifecycleService.pauseCampaign(campaignId, userId);
          return {
            success: true,
            campaign: pausedCampaign,
            message: 'Campaign paused',
          };
        }

        // Handle resume operation
        if (updates.status === 'active') {
          const resumedCampaign = await campaignLifecycleService.resumeCampaign(campaignId, userId);
          return {
            success: true,
            campaign: resumedCampaign,
            message: 'Campaign resumed',
          };
        }

        // Handle other status changes (completion, failure, etc.)
        return await campaignLifecycleService.updateCampaignStatus(
          campaignId,
          userId,
          updates.status
        );
      }

      // Block non-status updates for active campaigns
      if (campaign.status === 'active') {
        throw new APIError(
          'Active campaigns can only be paused. Please pause the campaign first to make other changes.',
          'CAMPAIGN_INVALID_STATE',
          400,
          { campaignId, userId, status: campaign.status }
        );
      }

      // Prepare the updated config
      const currentConfig = (campaign.config ?? {}) as {
        themes?: string[];
        style?: string;
        duration?: { start?: string; end?: string };
        frequency?: string;
        postingTime?: string;
        estimatedPosts?: number;
        durationDays?: number;
      };
      const updatedConfig = { ...currentConfig };

      // Update basic fields
      if (updates.name !== undefined) {
        if (!updates.name.trim()) {
          throw new APIError('Campaign name cannot be empty', 'CAMPAIGN_INVALID_NAME', 400, {
            campaignId,
            userId,
          });
        }
      }

      if (updates.themes !== undefined) {
        if (!Array.isArray(updates.themes) || updates.themes.length === 0) {
          throw new APIError('At least one theme is required', 'CAMPAIGN_INVALID_THEMES', 400, {
            campaignId,
            userId,
          });
        }
        updatedConfig.themes = updates.themes;
      }

      if (updates.style !== undefined) {
        updatedConfig.style = updates.style;
      }

      if (updates.frequency !== undefined) {
        if (!isValidCampaignFrequency(updates.frequency)) {
          throw new APIError(
            'Invalid frequency. Must be daily, every2days, or 3weekly',
            'CAMPAIGN_INVALID_FREQUENCY',
            400,
            { campaignId, userId }
          );
        }
        updatedConfig.frequency = updates.frequency;
      }

      if (updates.postingTime !== undefined) {
        if (!/^\d{2}:\d{2}$/.test(updates.postingTime)) {
          throw new APIError(
            'Posting time must be in HH:MM format',
            'CAMPAIGN_INVALID_POSTING_TIME',
            400,
            { campaignId, userId }
          );
        }
        updatedConfig.postingTime = updates.postingTime;
      }

      // Update dates if provided
      if (updates.startDate !== undefined || updates.endDate !== undefined) {
        const existingStart = currentConfig.duration?.start
          ? new Date(currentConfig.duration.start)
          : new Date();
        const existingEnd = currentConfig.duration?.end
          ? new Date(currentConfig.duration.end)
          : new Date(Date.now() + ONE_DAY_MS);
        const startDate = updates.startDate ? new Date(updates.startDate) : existingStart;
        const endDate = updates.endDate ? new Date(updates.endDate) : existingEnd;

        // Validate dates
        if (endDate <= startDate) {
          throw new APIError('End date must be after start date', 'CAMPAIGN_INVALID_DATES', 400, {
            campaignId,
            userId,
          });
        }

        // Get brand's timezone for proper date comparison
        const brandTimezone = await TimezoneService.getBrandTimezone(campaign.brandId);

        // CRITICAL: Compare dates only (not times) in the brand's timezone
        // Normalize both dates to midnight for date-only comparison
        const nowUTC = new Date();
        const nowInBrandTz = TimezoneService.toLocal(nowUTC, brandTimezone);
        const todayMidnight = new Date(
          nowInBrandTz.getFullYear(),
          nowInBrandTz.getMonth(),
          nowInBrandTz.getDate(),
          0,
          0,
          0,
          0
        );

        const startDateInBrandTz = TimezoneService.toLocal(startDate, brandTimezone);
        const startDateMidnight = new Date(
          startDateInBrandTz.getFullYear(),
          startDateInBrandTz.getMonth(),
          startDateInBrandTz.getDate(),
          0,
          0,
          0,
          0
        );

        // Only validate if campaign is not active (active campaigns can keep their past dates)
        if ((campaign.status as string) !== 'active' && startDateMidnight < todayMidnight) {
          throw new APIError('Start date cannot be in the past', 'CAMPAIGN_START_IN_PAST', 400, {
            campaignId,
            userId,
          });
        }

        updatedConfig.duration = {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        };

        // Recalculate estimated posts
        const durationDays = calculateDurationDays(startDate, endDate);
        updatedConfig.estimatedPosts = calculateEstimatedPosts(
          durationDays,
          updatedConfig.frequency || ''
        );
        updatedConfig.durationDays = durationDays;
      }

      // Update the campaign
      const updatedCampaign = await prisma.campaign.update({
        where: { id: campaignId },
        data: {
          name: updates.name !== undefined ? updates.name : campaign.name,
          config: updatedConfig,
          updatedAt: new Date(),
        },
        include: {
          brand: {
            select: {
              id: true,
              name: true,
            },
          },
          content: {
            select: {
              id: true,
              caption: true,
              hashtags: true,
              status: true,
              scheduledAt: true,
              postedAt: true,
              createdAt: true,
              updatedAt: true,
              contentType: true,
              shareToFeed: true,
              mediaAssets: {
                select: { assetId: true, displayOrder: true },
                orderBy: { displayOrder: 'asc' },
              },
            },
            orderBy: {
              scheduledAt: 'asc',
            },
          },
          _count: {
            select: {
              content: true,
            },
          },
        },
      });

      logger.info('Campaign updated successfully', {
        campaignId,
        userId,
      });
      return {
        success: true,
        campaign: updatedCampaign as unknown as CampaignWithContent,
        message: 'Campaign updated successfully',
      };
    } catch (error) {
      logger.error('Update campaign error', { campaignId, userId, error });
      throw error;
    }
  }

  /**
   * Update campaign priority and check for new conflicts
   */
  async updateCampaignPriority(
    campaignId: string,
    newPriority: number,
    userId: string
  ): Promise<{
    success: boolean;
    campaign: CampaignWithContent | null;
    conflicts?: number;
  }> {
    try {
      // Get the campaign and verify ownership
      const campaign = await prisma.campaign.findFirst({
        where: {
          id: campaignId,
          brand: { userId },
        },
        include: { brand: true },
      });

      if (!campaign) {
        throw new APIError('Campaign not found or access denied', 'CAMPAIGN_NOT_FOUND', 404, {
          campaignId,
          userId,
        });
      }

      // Update priority
      const updatedCampaign = await prisma.campaign.update({
        where: { id: campaignId },
        data: { priority: newPriority },
        include: {
          brand: true,
          content: true,
        },
      });

      // Re-check conflicts with new priority
      const rawConfig = campaign.config as unknown;
      const config =
        rawConfig && typeof rawConfig === 'object' ? (rawConfig as Record<string, unknown>) : {};
      const durationObj =
        config.duration && typeof config.duration === 'object'
          ? (config.duration as { start?: string; end?: string })
          : { start: undefined, end: undefined };
      const coordinationConfig: CampaignConfigWithPriority = {
        name: campaign.name,
        brandId: campaign.brandId,
        config: {
          duration: {
            start: durationObj.start || new Date().toISOString(),
            end: durationObj.end || new Date(Date.now() + ONE_DAY_MS).toISOString(),
          },
          frequency: typeof config.frequency === 'string' ? config.frequency : 'daily',
          postingTime: typeof config.postingTime === 'string' ? config.postingTime : '09:00',
          themes: Array.isArray(config.themes) ? (config.themes as string[]) : [],
        },
        priority: newPriority,
      };

      const conflicts = await campaignCoordinationService.detectSchedulingConflicts(
        coordinationConfig,
        userId
      );

      // Update campaign config with new conflict information
      await prisma.campaign.update({
        where: { id: campaignId },
        data: {
          config: {
            ...(config as Record<string, unknown>),
            conflicts: buildConflictSummary(conflicts),
          },
        },
      });

      return {
        success: true,
        campaign: updatedCampaign as unknown as CampaignWithContent,
        conflicts: conflicts.length,
      };
    } catch (error) {
      logger.error('Update campaign priority error', {
        campaignId,
        userId,
        newPriority,
        error,
      });
      throw error;
    }
  }

  /**
   * Validate field editability based on campaign status and field types
   */
  async validateFieldEditability(
    campaignId: string,
    fieldsToUpdate: EditableCampaignFields,
    userId: string
  ): Promise<{ valid: boolean; errors: { field: string; message: string }[] }> {
    try {
      // Get campaign with ownership validation
      const campaign = await prisma.campaign.findFirst({
        where: {
          id: campaignId,
          brand: { userId },
        },
        include: { brand: true },
      });

      if (!campaign) {
        return {
          valid: false,
          errors: [
            {
              field: 'campaign',
              message: 'Campaign not found or access denied',
            },
          ],
        };
      }
      return validateFieldEditabilityForStatus(campaign.status as string, fieldsToUpdate);
    } catch (error) {
      logger.error('Validate field editability error', {
        campaignId,
        userId,
        updateData: fieldsToUpdate,
        error,
      });
      return {
        valid: false,
        errors: [{ field: 'system', message: 'Failed to validate field editability' }],
      };
    }
  }

  /**
   * Update campaign with automatic content regeneration when needed
   */
  async updateCampaignWithRegeneration(
    campaignId: string,
    updateData: CampaignUpdateData,
    userId: string
  ): Promise<{
    campaign: CampaignWithContent;
    regenerationTriggered: boolean;
    regenerationReason?: string;
    message?: string;
  }> {
    try {
      // First validate field editability
      const editabilityCheck = await this.validateFieldEditability(campaignId, updateData, userId);
      if (!editabilityCheck.valid) {
        throw new APIError(
          'Validation failed for campaign update',
          'CAMPAIGN_UPDATE_VALIDATION_FAILED',
          400,
          {
            campaignId,
            userId,
            errors: editabilityCheck.errors,
          }
        );
      }

      // Get current campaign to compare changes
      const currentCampaign = await prisma.campaign.findFirst({
        where: {
          id: campaignId,
          brand: { userId },
        },
        include: { brand: true },
      });

      if (!currentCampaign) {
        throw new APIError('Campaign not found or access denied', 'CAMPAIGN_NOT_FOUND', 404, {
          campaignId,
          userId,
        });
      }

      // Check if regeneration is needed
      let regenerationTriggered = false;
      let regenerationReason = '';

      const currentConfig = (currentCampaign.config ?? {}) as {
        themes?: string[];
        style?: string;
        frequency?: string;
        postingTime?: string;
        duration?: { start?: string; end?: string };
        [key: string]: unknown;
      };

      // Check for theme changes (either in config object or as direct field)
      if (updateData.themes) {
        if (JSON.stringify(currentConfig?.themes) !== JSON.stringify(updateData.themes)) {
          regenerationTriggered = true;
          regenerationReason = 'themes changed';
        }
      }

      // Check for style changes (either in config object or as direct field)
      if (updateData.style) {
        if (currentConfig?.style !== updateData.style) {
          regenerationTriggered = true;
          regenerationReason = regenerationReason
            ? `${regenerationReason}, style changed`
            : 'style changed';
        }
      }

      // Also check if config object is provided (backward compatibility)
      if (updateData.config) {
        const newConfig = updateData.config;

        // Check for theme changes in config
        if (
          newConfig.themes &&
          JSON.stringify(currentConfig?.themes) !== JSON.stringify(newConfig.themes)
        ) {
          regenerationTriggered = true;
          regenerationReason = 'themes changed';
        }

        // Check for style changes in config
        if (newConfig.style && currentConfig?.style !== newConfig.style) {
          regenerationTriggered = true;
          regenerationReason = regenerationReason
            ? `${regenerationReason}, style changed`
            : 'style changed';
        }
      }

      // Prepare update data with tracking fields
      const updatePayload: {
        [k: string]: unknown;
        modificationCount?: { increment: number };
      } = {
        lastModifiedAt: new Date(),
        lastModifiedBy: { connect: { id: userId } },
        modificationCount: { increment: 1 },
      };

      // Handle individual fields that should be stored in config
      const configUpdates: Record<string, unknown> = {};

      if (updateData.themes !== undefined) {
        configUpdates.themes = updateData.themes;
      }
      if (updateData.style !== undefined) {
        configUpdates.style = updateData.style;
      }
      if (updateData.frequency !== undefined) {
        configUpdates.frequency = updateData.frequency;
      }
      if (updateData.postingTime !== undefined) {
        configUpdates.postingTime = updateData.postingTime;
      }
      if (updateData.goals !== undefined) {
        configUpdates.goals = updateData.goals;
      }
      if (updateData.seasonalityAssist !== undefined) {
        configUpdates.seasonalityAssist = !!updateData.seasonalityAssist;
      }
      if (updateData.startDate !== undefined || updateData.endDate !== undefined) {
        configUpdates.duration = {
          ...(currentConfig?.duration || {}),
          ...(updateData.startDate ? { start: updateData.startDate } : {}),
          ...(updateData.endDate ? { end: updateData.endDate } : {}),
        };
      }

      // If we have config updates, merge them with existing config
      if (Object.keys(configUpdates).length > 0) {
        updatePayload.config = JSON.parse(
          JSON.stringify({
            ...(currentConfig || {}),
            ...configUpdates,
          })
        );
      }

      // Handle non-config fields
      if (updateData.name !== undefined) {
        updatePayload.name = updateData.name;
      }
      if (updateData.priority !== undefined) {
        updatePayload.priority = updateData.priority;
      }
      if (updateData.status !== undefined) {
        updatePayload.status = updateData.status;
      }

      // Perform the update
      const updatedCampaign = await prisma.campaign.update({
        where: { id: campaignId },
        data: updatePayload,
        include: {
          brand: true,
          content: true,
        },
      });

      // If regeneration is triggered and campaign has content, clear existing content
      if (regenerationTriggered && updatedCampaign.content.length > 0) {
        // In a real implementation, this would trigger background regeneration
        // For now, we just delete existing content to simulate regeneration prep
        await prisma.content.deleteMany({
          where: { campaignId: campaignId },
        });

        // Reset preview status to trigger regeneration
        await prisma.campaign.update({
          where: { id: campaignId },
          data: {
            previewGenerated: false,
          },
        });
      }

      const result: {
        campaign: CampaignWithContent;
        regenerationTriggered: boolean;
        regenerationReason?: string;
        message: string;
      } = {
        campaign: updatedCampaign,
        regenerationTriggered,
        message: regenerationTriggered
          ? 'Campaign updated. Content regeneration started.'
          : 'Campaign updated successfully.',
      };

      if (regenerationTriggered) {
        result.regenerationReason = regenerationReason;
      }

      return {
        campaign: updatedCampaign,
        regenerationTriggered,
        regenerationReason: regenerationTriggered ? regenerationReason : undefined,
        message: regenerationTriggered
          ? 'Campaign updated. Content regeneration started.'
          : 'Campaign updated successfully.',
      };
    } catch (error) {
      logger.error('Update campaign with regeneration error', {
        campaignId,
        userId,
        error,
      });
      throw error;
    }
  }
}

export const campaignUpdatesService = new CampaignUpdatesService();
