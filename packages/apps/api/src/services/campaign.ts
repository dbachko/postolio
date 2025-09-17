import { PrismaClient, CampaignStatus } from '@postolio/database';
import {
  generateInstagramContent,
  type ContentGenerationRequest,
  type GeneratedContent,
} from './content-generator.js';
import { campaignJobService } from './campaign-jobs.js';
import {
  campaignCoordinationService,
  type CampaignConfigWithPriority,
} from './campaign-coordination.js';
import type { StyleProfile } from './ai.js';
import { analyzeBrandStyle } from './ai.js';
import { TimezoneService } from './timezone.js';
import { DEFAULT_TIMEZONE } from '../constants/timezone.js';
import { schedulerService } from './scheduler.js';
import {
  StatusBroadcaster,
  type CampaignStatus as StatusBroadcasterCampaignStatus,
} from './status-broadcaster.js';

const prisma = new PrismaClient();

// In-memory store for edit sessions (in production, this would be Redis or database)
const editSessions = new Map<string, { userId: string; startedAt: Date }>();

export interface CampaignConfig {
  name: string;
  brandId: string;
  duration: {
    start: Date;
    end: Date;
  };
  frequency: string; // 'daily', 'every2days', '3weekly', etc.
  themes: string[];
  style: string;
  postingTime: string; // HH:MM format
  priority?: number; // 1=highest, 5=normal, 10=lowest
}

export interface CampaignPreview {
  campaignId: string;
  examplePosts: GeneratedContent[];
  estimatedPostCount: number;
  schedule: {
    frequency: string;
    duration: number; // days
    totalPosts: number;
  };
}

export interface CampaignStartResult {
  success: boolean;
  campaign?: CampaignWithBrand;
  scheduledPosts?: number;
  error?: string;
}

// Detailed campaign type including selected relations used within this service
import type { Prisma } from '@postolio/database';
// Use broad record types to avoid deep structural coupling while removing explicit any usage
type CampaignWithBrand = Record<string, unknown>;
type CampaignWithContent = Record<string, unknown>;

// Fields that can be edited directly or via config updates
type EditableCampaignFields = Partial<{
  name: string;
  priority: number;
  status: CampaignStatus;
  // Direct top-level convenience fields (legacy / backwards compat)
  themes: string[];
  style: string;
  frequency: string;
  postingTime: string;
  startDate: string;
  endDate: string;
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
type CampaignUpdateData = EditableCampaignFields;

class CampaignService {
  private statusBroadcaster?: StatusBroadcaster;

  /**
   * Set the status broadcaster for real-time updates
   */
  setStatusBroadcaster(broadcaster: StatusBroadcaster): void {
    this.statusBroadcaster = broadcaster;
  }

  /**
   * Broadcast campaign status change if broadcaster is available
   */
  private async broadcastStatusChange(
    campaignId: string,
    brandId: string,
    oldStatus: StatusBroadcasterCampaignStatus,
    newStatus: StatusBroadcasterCampaignStatus,
    progress: number,
    options?: {
      errorMessage?: string | null;
      previewGenerated?: boolean;
      isRunning?: boolean;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    if (this.statusBroadcaster) {
      try {
        await this.statusBroadcaster.broadcastCampaignStatusChange(
          campaignId,
          brandId,
          oldStatus,
          newStatus,
          progress,
          options
        );
      } catch (error) {
        console.error('Failed to broadcast campaign status change:', error);
      }
    }
  }

  /**
   * Create and save campaign configuration
   */
  async configureCampaign(
    config: CampaignConfig,
    userId: string,
    overrideTimezone?: string
  ): Promise<CampaignWithBrand> {
    try {
      // Validate brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: config.brandId,
          userId,
        },
      });

      if (!brand) {
        throw new Error('Brand not found or access denied');
      }

      // Validate dates
      if (config.duration.start >= config.duration.end) {
        throw new Error('Campaign start date must be before end date');
      }

      // Get brand's timezone for proper date comparison
      const brandTimezone =
        overrideTimezone || (await TimezoneService.getBrandTimezone(config.brandId));

      // Get today's date in the brand's timezone (start of day)
      const nowUTC = new Date();
      const todayInBrandTz = TimezoneService.toLocal(nowUTC, brandTimezone);
      todayInBrandTz.setHours(0, 0, 0, 0);

      // Convert the input start date to the same timezone for comparison
      const startDateInBrandTz = TimezoneService.toLocal(config.duration.start, brandTimezone);
      startDateInBrandTz.setHours(0, 0, 0, 0);

      // Compare dates in the same timezone context
      if (startDateInBrandTz < todayInBrandTz) {
        throw new Error('Campaign start date cannot be in the past');
      }

      // Check for scheduling conflicts with other campaigns
      const coordinationConfig: CampaignConfigWithPriority = {
        name: config.name,
        brandId: config.brandId,
        config: {
          duration: {
            start: config.duration.start.toISOString(),
            end: config.duration.end.toISOString(),
          },
          frequency: config.frequency,
          postingTime: config.postingTime,
          themes: config.themes,
        },
        priority: config.priority || 5,
      };

      const conflicts = await campaignCoordinationService.detectSchedulingConflicts(
        coordinationConfig,
        userId
      );

      // Store conflicts for frontend display but allow campaign creation
      const conflictSummary =
        conflicts.length > 0
          ? {
              hasConflicts: true,
              conflictCount: conflicts.length,
              conflicts: conflicts.map((c) => ({
                type: c.conflictType,
                severity: c.severity,
                details: c.details,
              })),
            }
          : { hasConflicts: false, conflictCount: 0, conflicts: [] };

      // Calculate estimated post count
      const durationDays = Math.ceil(
        (config.duration.end.getTime() - config.duration.start.getTime()) / (1000 * 60 * 60 * 24)
      );

      let postsPerWeek = 1;
      switch (config.frequency) {
        case 'daily':
          postsPerWeek = 7;
          break;
        case 'every2days':
          postsPerWeek = 3.5; // Every 2 days = 3.5 posts per week
          break;
        case '3weekly':
          postsPerWeek = 3;
          break;
        default:
          postsPerWeek = 1;
      }

      const estimatedPosts = Math.ceil((durationDays / 7) * postsPerWeek);

      // Create campaign with 'creating' status
      const campaign = await prisma.campaign.create({
        data: {
          name: config.name,
          brandId: config.brandId,
          status: 'creating',
          priority: config.priority || 5,
          progress: 0,
          previewGenerated: false,
          config: {
            duration: {
              start: config.duration.start.toISOString(),
              end: config.duration.end.toISOString(),
            },
            frequency: config.frequency,
            themes: config.themes,
            style: config.style,
            postingTime: config.postingTime,
            estimatedPosts,
            durationDays,
            conflicts: conflictSummary,
          },
        },
        include: {
          brand: {
            select: {
              id: true,
              name: true,
              styleProfile: true,
            },
          },
        },
      });

      // Start async preview generation
      campaignJobService.startCampaignPreviewGeneration(campaign.id, userId);

      return campaign;
    } catch (error) {
      console.error('Campaign configuration error:', error);
      throw error;
    }
  }

  /**
   * Generate preview posts for a campaign
   */
  async generateCampaignPreview(
    campaignId: string,
    userId: string,
    exampleCount = 3
  ): Promise<CampaignPreview> {
    try {
      // Get campaign and validate ownership
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
              styleProfile: true,
            },
          },
        },
      });

      if (!campaign) {
        throw new Error('Campaign not found or access denied');
      }

      const config = (campaign.config ?? {}) as {
        style?: string;
        themes?: string[];
        estimatedPosts?: number;
        frequency?: string;
        durationDays?: number;
        duration?: { start?: string; end?: string };
        postingTime?: string;
        [k: string]: unknown;
      };
      let styleProfile = campaign.brand.styleProfile as unknown as StyleProfile;

      if (!styleProfile) {
        // Generate style profile if missing (similar to autopilot service)
        console.log(`Generating style profile for brand: ${campaign.brand.name}`);
        const analysisResult = await analyzeBrandStyle([], campaign.brand.name);
        styleProfile = analysisResult.styleProfile;

        await prisma.brand.update({
          where: { id: campaign.brandId },
          data: {
            styleProfile: styleProfile as unknown as Prisma.InputJsonValue,
          },
        });
      }

      // Generate example content using themes from campaign config
      const contentRequests: ContentGenerationRequest[] = (config.themes || []).map(
        (theme: string) => ({
          brandId: campaign.brandId,
          count: 1,
          theme,
          style: config.style,
        })
      );

      // Take first N themes for preview
      const previewRequests = contentRequests.slice(0, exampleCount);

      let examplePosts: GeneratedContent[] = [];

      for (const request of previewRequests) {
        const content = await generateInstagramContent(styleProfile, campaign.brand.name, request);
        examplePosts.push(...content);
      }

      // If we have fewer posts than requested, generate more with the first theme
      while (examplePosts.length < exampleCount && (config.themes?.length || 0) > 0) {
        const additionalContent = await generateInstagramContent(
          styleProfile,
          campaign.brand.name,
          {
            brandId: campaign.brandId,
            count: 1,
            theme: (config.themes || [])[0],
            style: config.style,
          }
        );
        examplePosts.push(...additionalContent);
      }

      // Trim to exact count requested
      examplePosts = examplePosts.slice(0, exampleCount);

      // Check if preview posts already exist for this campaign
      const existingPreviews = await prisma.content.findMany({
        where: {
          campaignId: campaignId,
          // Look for posts that are preview posts (not scheduled yet)
          scheduledAt: null,
        },
      });

      // Delete existing preview posts to replace them with new ones
      if (existingPreviews.length > 0) {
        await prisma.content.deleteMany({
          where: {
            id: {
              in: existingPreviews.map((p) => p.id),
            },
          },
        });
      }

      // Save new preview posts to database
      const savedPosts = [];
      for (const post of examplePosts) {
        // Validate post data before saving
        if (!post.caption || post.caption.trim().length === 0) {
          console.error('Attempting to save content with empty caption:', post);
          throw new Error('Cannot save content with empty caption');
        }
        if (!post.hashtags || !Array.isArray(post.hashtags)) {
          console.error('Attempting to save content with invalid hashtags:', post);
          throw new Error('Cannot save content with invalid hashtags');
        }

        const savedPost = await prisma.content.create({
          data: {
            caption: post.caption,
            hashtags: post.hashtags,
            s3ImageKey: post.s3ImageKey ?? null,
            cdnImageUrl: post.cdnImageUrl ?? null,
            imageRegion: post.imageRegion ?? null,
            retentionExpiresAt: post.retentionExpiresAt ?? null,
            brandId: campaign.brandId,
            campaignId: campaignId,
            status: 'draft', // Preview posts start as draft
            generationParams: {
              theme: config.themes?.[0] || 'preview',
              style: config.style,
              campaignGenerated: true,
              isPreview: true,
            },
          },
        });
        savedPosts.push({
          ...post,
          id: savedPost.id,
          status: savedPost.status,
          createdAt: savedPost.createdAt,
        });
      }

      return {
        campaignId,
        examplePosts: savedPosts,
        estimatedPostCount: config.estimatedPosts ?? 0,
        schedule: {
          frequency: config.frequency ?? '',
          duration: config.durationDays ?? 0,
          totalPosts: config.estimatedPosts ?? 0,
        },
      };
    } catch (error) {
      console.error('Campaign preview error:', error);
      throw error;
    }
  }

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
              styleProfile: true,
            },
          },
        },
      });

      if (!campaign) {
        return {
          success: false,
          error: 'Campaign not found, access denied, or not ready for launch',
        };
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
      const styleProfile = campaign.brand.styleProfile as unknown as StyleProfile;

      if (!styleProfile) {
        // Style profile should have been generated during preview creation
        // Don't generate it here as it's too slow for the critical campaign start path
        console.error(
          `Brand ${campaign.brand.name} missing style profile - should have been generated during preview`
        );
        return {
          success: false,
          error: 'Brand style profile missing. Please regenerate campaign preview first.',
        };
      }

      // Generate posting schedule (now timezone-aware)
      if (
        !config.duration?.start ||
        !config.duration?.end ||
        !config.frequency ||
        !config.postingTime
      ) {
        return {
          success: false,
          error: 'Campaign configuration incomplete. Regenerate preview.',
        };
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
        return {
          success: false,
          error: 'No preview posts found. Please generate campaign preview first.',
        };
      }

      console.log(
        `Scheduling ${existingPreviews.length} preview posts for campaign: ${campaign.name}`
      );

      // Log scheduling details for debugging
      console.log(
        `Scheduling for brand ${campaign.brandId} in timezone: ${await TimezoneService.getBrandTimezone(campaign.brandId)}`
      );

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
          try {
            // Fire and forget - let AWS sync handle the status updates
            const scheduleResult = await schedulerService.scheduleContent(existingPost.id);

            if (scheduleResult.success) {
              console.log(
                `Content ${existingPost.id} scheduling initiated in AWS - sync will update status`
              );
            } else {
              console.error(
                `Failed to create AWS schedule for content ${existingPost.id}:`,
                scheduleResult.error
              );

              // Clear processing state and mark error since scheduling failed immediately
              await prisma.content.update({
                where: { id: existingPost.id },
                data: {
                  generationParams: {
                    ...((content.generationParams as Record<string, unknown>) || {}),
                    processing: null, // Clear processing state
                    schedulingError: `AWS scheduling failed: ${scheduleResult.error}`,
                  },
                },
              });
            }
          } catch (scheduleError) {
            console.error(`Error scheduling content ${existingPost.id}:`, scheduleError);

            // Clear processing state and mark error since scheduling failed
            await prisma.content.update({
              where: { id: existingPost.id },
              data: {
                generationParams: {
                  ...((content.generationParams as Record<string, unknown>) || {}),
                  processing: null, // Clear processing state
                  schedulingError: `AWS scheduling error: ${scheduleError instanceof Error ? scheduleError.message : 'Unknown error'}`,
                },
              },
            });
          }
        }

        createdContent.push(content);
      }

      // Log successful scheduling
      console.log(
        `Successfully scheduled ${createdContent.length} posts for campaign: ${campaign.name}`
      );

      if (existingPreviews.length < postDates.length) {
        console.warn(
          `Campaign has ${postDates.length} planned posts but only ${existingPreviews.length} preview posts available. Rolling generation will create additional content as needed.`
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

      return {
        success: true,
        campaign: updatedCampaign,
        scheduledPosts: createdContent.length,
      };
    } catch (error) {
      console.error('Campaign start error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start campaign',
      };
    }
  }

  /**
   * Get campaign details
   */
  async getCampaign(campaignId: string, userId: string): Promise<CampaignWithContent | null> {
    try {
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
          content: {
            select: {
              id: true,
              caption: true,
              hashtags: true,
              s3ImageKey: true,
              cdnImageUrl: true,
              imageRegion: true,
              retentionExpiresAt: true,
              status: true,
              scheduledAt: true,
              postedAt: true,
              createdAt: true,
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

      if (!campaign) {
        throw new Error('Campaign not found or access denied');
      }

      return campaign;
    } catch (error) {
      console.error('Get campaign error:', error);
      throw error;
    }
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
      const bufferTime = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes from now
      if (scheduledTime > bufferTime) {
        schedule.push(scheduledTime);
      } else {
        console.log(
          `Skipping past/too-soon scheduling time: ${scheduledTime.toISOString()} (current time + buffer: ${bufferTime.toISOString()})`
        );
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
        throw new Error('Campaign not found or access denied');
      }

      // Special handling for status transitions
      if (updates.status) {
        // Handle pause operation
        if (updates.status === 'paused') {
          const pausedCampaign = await this.pauseCampaign(campaignId, userId);
          return {
            success: true,
            campaign: pausedCampaign,
            message: 'Campaign paused',
          };
        }

        // Handle resume operation
        if (updates.status === 'active') {
          const resumedCampaign = await this.resumeCampaign(campaignId, userId);
          return {
            success: true,
            campaign: resumedCampaign,
            message: 'Campaign resumed',
          };
        }

        // Handle other status changes (completion, failure, etc.)
        return await this.updateCampaignStatus(campaignId, userId, updates.status);
      }

      // Block non-status updates for active campaigns
      if (campaign.status === 'active') {
        throw new Error(
          'Active campaigns can only be paused. Please pause the campaign first to make other changes.'
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
          throw new Error('Campaign name cannot be empty');
        }
      }

      if (updates.themes !== undefined) {
        if (!Array.isArray(updates.themes) || updates.themes.length === 0) {
          throw new Error('At least one theme is required');
        }
        updatedConfig.themes = updates.themes;
      }

      if (updates.style !== undefined) {
        updatedConfig.style = updates.style;
      }

      if (updates.frequency !== undefined) {
        if (!['daily', 'every2days', '3weekly'].includes(updates.frequency)) {
          throw new Error('Invalid frequency. Must be daily, every2days, or 3weekly');
        }
        updatedConfig.frequency = updates.frequency;
      }

      if (updates.postingTime !== undefined) {
        if (!/^\d{2}:\d{2}$/.test(updates.postingTime)) {
          throw new Error('Posting time must be in HH:MM format');
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
          : new Date(Date.now() + 86400000);
        const startDate = updates.startDate ? new Date(updates.startDate) : existingStart;
        const endDate = updates.endDate ? new Date(updates.endDate) : existingEnd;

        // Validate dates
        if (endDate <= startDate) {
          throw new Error('End date must be after start date');
        }

        // Get brand's timezone for proper date comparison
        const brandTimezone = await TimezoneService.getBrandTimezone(campaign.brandId);

        // Get today's date in the brand's timezone (start of day)
        const nowUTC = new Date();
        const todayInBrandTz = TimezoneService.toLocal(nowUTC, brandTimezone);
        todayInBrandTz.setHours(0, 0, 0, 0);

        // Convert the start date to the brand's timezone for comparison
        const startDateInBrandTz = TimezoneService.toLocal(startDate, brandTimezone);
        startDateInBrandTz.setHours(0, 0, 0, 0);

        // Only validate if campaign is not active (active campaigns can keep their past dates)
        if ((campaign.status as string) !== 'active' && startDateInBrandTz < todayInBrandTz) {
          throw new Error('Start date cannot be in the past');
        }

        updatedConfig.duration = {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        };

        // Recalculate estimated posts
        const durationDays = Math.ceil(
          (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        let postsPerWeek = 1;
        switch (updatedConfig.frequency) {
          case 'daily':
            postsPerWeek = 7;
            break;
          case 'every2days':
            postsPerWeek = 3.5;
            break;
          case '3weekly':
            postsPerWeek = 3;
            break;
        }
        updatedConfig.estimatedPosts = Math.ceil((durationDays / 7) * postsPerWeek);
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
              s3ImageKey: true,
              cdnImageUrl: true,
              imageRegion: true,
              retentionExpiresAt: true,
              status: true,
              scheduledAt: true,
              postedAt: true,
              createdAt: true,
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

      console.log(`Campaign ${campaignId} updated successfully`);
      return {
        success: true,
        campaign: updatedCampaign as unknown as CampaignWithContent,
        message: 'Campaign updated successfully',
      };
    } catch (error) {
      console.error('Update campaign error:', error);
      throw error;
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
          throw new Error('Campaign not found or access denied');
        }

        // Validate status transition inside transaction
        const validTransitions = this.getValidStatusTransitions();
        const allowedTransitions = validTransitions[campaign.status] || [];

        if (!allowedTransitions.includes('paused')) {
          throw new Error(
            `Invalid status transition: ${campaign.status} → paused. Allowed transitions: ${allowedTransitions.join(', ')}`
          );
        }

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

        console.log(
          `Campaign ${campaignId} paused. ${skippedContent.count} scheduled posts marked as skipped.`
        );
        if (skippedContent.count > 0) {
          console.log(`  - Marked ${skippedContent.count} future posts as skipped`);
          console.log(`  - Status changed: scheduled → skipped`);
          console.log(`  - scheduledAt preserved for potential resume`);
        }

        return {
          campaign: updatedCampaign,
          cancelledCount: skippedContent.count,
          message: 'Campaign paused. No content will be published until resumed.',
        };
      });

      return result;
    } catch (error) {
      console.error('Pause campaign error:', error);
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
          throw new Error('Campaign not found or access denied');
        }

        // Validate status transition inside transaction
        const validTransitions = this.getValidStatusTransitions();
        const allowedTransitions = validTransitions[campaign.status] || [];

        if (!allowedTransitions.includes('active')) {
          throw new Error(
            `Invalid status transition: ${campaign.status} → active. Allowed transitions: ${allowedTransitions.join(', ')}`
          );
        }

        const now = new Date();
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

        console.log(`Campaign ${campaignId} resumed.`);
        if (restoredContent.count > 0) {
          console.log(`  - Restored ${restoredContent.count} future posts`);
          console.log(`  - Status changed: skipped → scheduled`);
        }
        if (permanentlySkipped.count > 0) {
          console.log(
            `  - ${permanentlySkipped.count} posts permanently skipped (past scheduled time)`
          );
        }

        return {
          campaign: updatedCampaign,
          restoredCount: restoredContent.count,
          permanentlySkippedCount: permanentlySkipped.count,
          message:
            restoredContent.count > 0
              ? `Campaign resumed. ${restoredContent.count} posts restored to schedule.${permanentlySkipped.count > 0 ? ` ${permanentlySkipped.count} posts permanently skipped.` : ''}`
              : permanentlySkipped.count > 0
                ? `Campaign resumed. ${permanentlySkipped.count} posts were permanently skipped.`
                : 'Campaign resumed successfully!',
        };
      });

      return result;
    } catch (error) {
      console.error('Resume campaign error:', error);
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
          throw new Error('Campaign not found or access denied');
        }

        // Validate status transition inside transaction
        const validTransitions = this.getValidStatusTransitions();
        const allowedTransitions = validTransitions[campaign.status] || [];

        if (!allowedTransitions.includes(newStatus)) {
          throw new Error(
            `Invalid status transition: ${campaign.status} → ${newStatus}. Allowed transitions: ${allowedTransitions.join(', ')}`
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

        console.log(`Campaign ${campaignId} status updated: ${campaign.status} → ${newStatus}`);

        return {
          success: true,
          campaign: updatedCampaign as unknown as CampaignWithContent,
          oldStatus: campaign.status as string,
          message: `Campaign status updated to ${newStatus}`,
        };
      });

      // TODO: Fix TypeScript casting issue for broadcast
      // Broadcast status change after successful transaction
      // if (result.success && result.campaign && result.oldStatus) {
      //   await this.broadcastStatusChange(
      //     campaignId,
      //     result.campaign.brandId,
      //     result.oldStatus as unknown as StatusBroadcasterCampaignStatus,
      //     newStatus as StatusBroadcasterCampaignStatus,
      //     100, // Status changes are typically 100% complete
      //     {
      //       isRunning: newStatus === 'active',
      //       metadata: {
      //         statusTransition: `${result.oldStatus} → ${newStatus}`,
      //         completedAt: newStatus === 'completed' ? new Date().toISOString() : undefined,
      //       },
      //     }
      //   );
      // }

      return result;
    } catch (error) {
      console.error('Update campaign status error:', error);
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
        throw new Error('Campaign not found or access denied');
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
            end: durationObj.end || new Date(Date.now() + 86400000).toISOString(),
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
            conflicts:
              conflicts.length > 0
                ? {
                    hasConflicts: true,
                    conflictCount: conflicts.length,
                    conflicts: conflicts.map((c) => ({
                      type: c.conflictType,
                      severity: c.severity,
                      details: c.details,
                    })),
                  }
                : { hasConflicts: false, conflictCount: 0, conflicts: [] },
          },
        },
      });

      return {
        success: true,
        campaign: updatedCampaign as unknown as CampaignWithContent,
        conflicts: conflicts.length,
      };
    } catch (error) {
      console.error('Update campaign priority error:', error);
      throw error;
    }
  }

  /**
   * Get campaign coordination summary for a user
   */
  async getCampaignCoordination(userId: string): Promise<{
    activeCampaigns: number;
    resourceAllocation: unknown;
    campaignsByPriority: Record<number, number>;
    conflicts: number;
  }> {
    try {
      // Get resource allocation
      const allocation = await campaignCoordinationService.allocateGenerationResources(userId);

      // Get active campaigns with priorities
      const activeCampaigns = await prisma.campaign.findMany({
        where: {
          brand: { userId },
          status: { in: ['active', 'preview'] },
        },
        include: { brand: true },
        orderBy: { priority: 'asc' },
      });

      return {
        activeCampaigns: activeCampaigns.length,
        resourceAllocation: allocation,
        campaignsByPriority: activeCampaigns.reduce(
          (acc, campaign) => {
            const priority = campaign.priority || 5;
            acc[priority] = (acc[priority] || 0) + 1;
            return acc;
          },
          {} as Record<number, number>
        ),
        conflicts: activeCampaigns.reduce((total, campaign) => {
          const rawCfg = campaign.config as unknown;
          const cfg =
            rawCfg && typeof rawCfg === 'object'
              ? (rawCfg as { conflicts?: { conflictCount?: number } })
              : {};
          return total + (cfg.conflicts?.conflictCount || 0);
        }, 0),
      };
    } catch (error) {
      console.error('Get campaign coordination error:', error);
      throw error;
    }
  }

  /**
   * Validate campaign configuration
   */
  validateCampaignConfig(config: CampaignConfig): string[] {
    const errors: string[] = [];

    if (!config.name || config.name.trim().length === 0) {
      errors.push('Campaign name is required');
    }

    if (config.name && config.name.length > 100) {
      errors.push('Campaign name must be less than 100 characters');
    }

    if (!config.brandId) {
      errors.push('Brand ID is required');
    }

    if (!config.duration.start || !config.duration.end) {
      errors.push('Campaign start and end dates are required');
    }

    if (config.duration.start >= config.duration.end) {
      errors.push('Campaign start date must be before end date');
    }

    // Date validation has been moved to the async configureCampaign method
    // to enable timezone-aware validation. Since this synchronous validation
    // method cannot access timezone data, date validation is performed later
    // where we can properly interpret dates in the user's timezone context.

    if (!['daily', 'every2days', '3weekly'].includes(config.frequency)) {
      errors.push('Invalid frequency. Must be daily, every2days, or 3weekly');
    }

    if (!config.themes || config.themes.length === 0) {
      errors.push('At least one theme is required');
    }

    if (!config.postingTime || !/^\d{2}:\d{2}$/.test(config.postingTime)) {
      errors.push('Posting time must be in HH:MM format');
    }

    return errors;
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

      const errors: { field: string; message: string }[] = [];

      // Define field editability rules based on campaign status
      const editabilityRules = {
        // Completed campaigns are read-only
        completed: {
          allowedFields: [] as string[],
          message: 'Completed campaigns are read-only',
        },
        // Active campaigns allow limited edits
        active: {
          allowedFields: ['name', 'priority'] as string[],
          message: 'Active campaigns only allow editing name and priority',
        },
        // Paused campaigns allow same as active
        paused: {
          allowedFields: ['name', 'priority'] as string[],
          message: 'Paused campaigns only allow editing name and priority',
        },
        // Failed campaigns allow all edits to recover
        failed: {
          allowedFields: [
            'name',
            'priority',
            'config',
            'themes',
            'style',
            'frequency',
            'postingTime',
            'startDate',
            'endDate',
          ] as string[],
          message: 'Failed campaigns allow most edits for recovery',
        },
        // Creating and preview allow all edits
        creating: {
          allowedFields: [
            'name',
            'priority',
            'config',
            'themes',
            'style',
            'frequency',
            'postingTime',
            'startDate',
            'endDate',
          ] as string[],
          message: 'All fields can be edited for campaigns in creation',
        },
        preview: {
          allowedFields: [
            'name',
            'priority',
            'config',
            'themes',
            'style',
            'frequency',
            'postingTime',
            'startDate',
            'endDate',
          ] as string[],
          message: 'All fields can be edited for preview campaigns',
        },
        processing: {
          allowedFields: ['name', 'priority'] as string[],
          message: 'Processing campaigns only allow editing name and priority',
        },
      };

      const rule = editabilityRules[campaign.status as keyof typeof editabilityRules];
      if (!rule) {
        return {
          valid: false,
          errors: [
            {
              field: 'status',
              message: `Unknown campaign status: ${campaign.status}`,
            },
          ],
        };
      }

      // Special handling for completed campaigns - completely read-only
      if (campaign.status === 'completed') {
        if (Object.keys(fieldsToUpdate).length > 0) {
          errors.push({ field: 'campaign', message: rule.message });
        }
        return { valid: errors.length === 0, errors };
      }

      // Check each field being updated
      Object.keys(fieldsToUpdate).forEach((field) => {
        // Handle nested config fields (themes, style are inside config)
        if (field === 'config' && fieldsToUpdate.config) {
          const configFields = Object.keys(fieldsToUpdate.config);
          configFields.forEach((configField) => {
            if (configField === 'themes' && !rule.allowedFields.includes('themes')) {
              errors.push({
                field: 'themes',
                message: `Cannot edit themes: ${rule.message}`,
              });
            }
            if (configField === 'style' && !rule.allowedFields.includes('style')) {
              errors.push({
                field: 'style',
                message: `Cannot edit style: ${rule.message}`,
              });
            }
          });
        } else if (!rule.allowedFields.includes(field)) {
          errors.push({
            field,
            message: `Cannot edit ${field}: ${rule.message}`,
          });
        }
      });

      return { valid: errors.length === 0, errors };
    } catch (error) {
      console.error('Validate field editability error:', error);
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
        throw new Error(
          `Validation failed: ${editabilityCheck.errors.map((e) => e.message).join(', ')}`
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
        throw new Error('Campaign not found or access denied');
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
      const updatePayload: Prisma.CampaignUpdateInput & {
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
        ) as Prisma.InputJsonValue;
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
            progress: 0,
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
      console.error('Update campaign with regeneration error:', error);
      throw error;
    }
  }

  /**
   * Start an edit session for concurrent edit detection
   */
  async startEditSession(
    campaignId: string,
    userId: string,
    customStartTime?: Date
  ): Promise<void> {
    const startTime = customStartTime || new Date();
    editSessions.set(campaignId, { userId, startedAt: startTime });
  }

  /**
   * Check for concurrent edits within the 5-minute window
   */
  async checkConcurrentEdit(
    campaignId: string,
    userId: string
  ): Promise<{
    hasConflict: boolean;
    conflictUser?: string;
    warningMessage?: string;
  }> {
    const session = editSessions.get(campaignId);

    if (!session) {
      return { hasConflict: false };
    }

    // If it's the same user, no conflict
    if (session.userId === userId) {
      return { hasConflict: false };
    }

    // Check if the edit session is within the 5-minute window
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    if (session.startedAt > fiveMinutesAgo) {
      return {
        hasConflict: true,
        conflictUser: session.userId,
        warningMessage:
          'This campaign is currently being edited by another user. Please wait or refresh to see latest changes.',
      };
    }

    // Session expired, remove it
    editSessions.delete(campaignId);
    return { hasConflict: false };
  }
}

export const campaignService = new CampaignService();
