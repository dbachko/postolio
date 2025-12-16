import { CampaignTypeEnum, Prisma } from '@postolio/database';
import {
  generateInstagramContent,
  type ContentGenerationRequest,
  type GeneratedContent,
} from '../content-generator.js';
import { campaignJobService } from '../campaign-jobs.js';
import {
  campaignCoordinationService,
  type CampaignConflictCheckInput,
} from '../campaign-coordination.js';
import { TimezoneService } from '../timezone.js';
import { generateCampaignName } from '../../utils/campaign-naming.js';
import { resolveGeneratedImageAsset, attachAssetToContent } from '../assets-media.js';
import { getDatabaseClient } from '../../config/database.js';
import { extractHashtagsFromCaption } from '../../utils/hashtag-extractor.js';
import { logger as baseLogger } from '@postolio/logger';
import { APIError } from '@postolio/errors';
import { buildConflictSummary } from './campaign-conflicts.js';
import {
  calculateDurationDays,
  calculateEstimatedPosts,
  isValidCampaignFrequency,
} from './campaign-frequency.js';
import type { CampaignConfig, CampaignPreview } from './campaign-types.js';
import type { ImageProvider } from '../image-providers/types.js';

const prisma = getDatabaseClient();
const logger = baseLogger.child({ module: 'campaign-creation-service' });

type CampaignWithBrand = Record<string, unknown>;

export class CampaignCreationService {
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
        throw new APIError('Campaign not found or access denied', 'CAMPAIGN_NOT_FOUND', 404, {
          brandId: config.brandId,
          userId,
        });
      }

      // Validate dates
      if (config.duration.start >= config.duration.end) {
        throw new APIError(
          'Campaign start date must be before end date',
          'CAMPAIGN_INVALID_DATES',
          400,
          {
            brandId: config.brandId,
            start: config.duration.start.toISOString(),
            end: config.duration.end.toISOString(),
          }
        );
      }

      // Get brand's timezone for proper date comparison
      const brandTimezone =
        overrideTimezone || (await TimezoneService.getBrandTimezone(config.brandId));

      // CRITICAL: Compare dates only (not times) in the brand's timezone
      // Normalize both dates to midnight for date-only comparison
      const nowUTC = new Date();
      const todayMidnight = TimezoneService.getMidnightInTimezone(nowUTC, brandTimezone);
      const startDateMidnight = TimezoneService.getMidnightInTimezone(
        config.duration.start,
        brandTimezone
      );

      // Compare dates without time components
      // Allow start date to be today or in the future
      if (startDateMidnight < todayMidnight) {
        throw new APIError(
          'Campaign start date cannot be in the past',
          'CAMPAIGN_INVALID_DATES',
          400,
          {
            brandId: config.brandId,
            start: config.duration.start.toISOString(),
            today: todayMidnight.toISOString(),
            timezone: brandTimezone,
          }
        );
      }

      // Check for scheduling conflicts with other campaigns
      const coordinationConfig: CampaignConflictCheckInput = {
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
      };

      const conflicts = await campaignCoordinationService.detectSchedulingConflicts(
        coordinationConfig,
        userId
      );

      // Store conflicts for frontend display but allow campaign creation
      const conflictSummary = buildConflictSummary(conflicts);

      // Calculate estimated post count
      const durationDays = calculateDurationDays(config.duration.start, config.duration.end);
      const estimatedPosts = calculateEstimatedPosts(durationDays, config.frequency);

      // Auto-assign campaign color for calendar visualization
      const existingCampaigns = await prisma.campaign.findMany({
        where: { brandId: config.brandId },
        select: { color: true },
      });
      const { assignCampaignColor } = await import('../../utils/campaign-colors.js');
      const assignedColor = assignCampaignColor(existingCampaigns.map((c) => c.color));

      // Auto-generate campaign name if not provided
      const campaignName =
        config.name && config.name.trim().length > 0
          ? config.name
          : generateCampaignName({
              campaignType: config.campaignType || 'custom',
              themes: config.themes || [],
              startDate: config.duration.start.toISOString(),
              timezone: brandTimezone, // Use brand's timezone for accurate month/year
            });

      // Create campaign with 'creating' status
      const campaign = await prisma.campaign.create({
        data: {
          name: campaignName,
          brandId: config.brandId,
          status: 'creating',
          previewGenerated: false,
          color: assignedColor,
          campaignType: (config.campaignType as CampaignTypeEnum) ?? CampaignTypeEnum.custom,
          // Persist structured metadata (Phase 1 manual, Phase 2 AI-generated)
          ...(config.contentPillars
            ? { contentPillars: config.contentPillars as Prisma.InputJsonValue }
            : {}),
          ...(config.urgencyTactics
            ? { urgencyTactics: config.urgencyTactics as Prisma.InputJsonValue }
            : {}),
          ...(config.seasonalContext
            ? { seasonalContext: config.seasonalContext as Prisma.InputJsonValue }
            : {}),
          config: {
            duration: {
              start: config.duration.start.toISOString(),
              end: config.duration.end.toISOString(),
            },
            frequency: config.frequency,
            themes: config.themes,
            ...(config.style && config.style.trim().length > 0 ? { style: config.style } : {}),
            ...(config.imageProvider ? { imageProvider: config.imageProvider } : {}),
            postingTime: config.postingTime,
            estimatedPosts,
            durationDays,
            conflicts: conflictSummary,
            ...(config.goals ? { goals: config.goals } : {}),
            ...(config.seasonalityAssist !== undefined
              ? { seasonalityAssist: !!config.seasonalityAssist }
              : { seasonalityAssist: true }),
          },
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

      // Start async preview generation with error handling and logging
      logger.info('[CampaignCreationService] Triggering preview generation for campaign preview', {
        campaignId: campaign.id,
        brandId: campaign.brandId,
      });
      try {
        // Await the start (which is non-blocking for the actual work) to ensure it kicks off successfully
        await campaignJobService.startCampaignPreviewGeneration(campaign.id, userId);
      } catch (jobError) {
        logger.error('Failed to start preview generation', {
          campaignId: campaign.id,
          error: jobError,
        });
        // We don't block the response, but we log the error to ensure visibility
        // In a critical system we might want to revert the campaign creation, but here we let it persist
        // so the user sees the 'creating' (or failed) state.
      }

      return campaign;
    } catch (error) {
      logger.error('Campaign configuration error', { error, userId });
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
        throw new APIError('Campaign not found or access denied', 'CAMPAIGN_NOT_FOUND', 404, {
          campaignId,
          userId,
        });
      }

      const config = (campaign.config ?? {}) as {
        style?: string;
        themes?: string[];
        imageProvider?: ImageProvider;
        estimatedPosts?: number;
        frequency?: string;
        durationDays?: number;
        duration?: { start?: string; end?: string };
        postingTime?: string;
        [k: string]: unknown;
      };

      // Generate example content using themes from campaign config
      const contentRequests: ContentGenerationRequest[] = (config.themes || []).map(
        (theme: string) => ({
          brandId: campaign.brandId,
          count: 1,
          theme,
          style: config.style,
          campaignId: campaign.id,
          imageProvider: config.imageProvider,
        })
      );

      // Take first N themes for preview
      const previewRequests = contentRequests.slice(0, exampleCount);

      let examplePosts: GeneratedContent[] = [];

      for (const request of previewRequests) {
        const content = await generateInstagramContent(campaign.brand.name, request);
        examplePosts.push(...content);
      }

      // If we have fewer posts than requested, generate more with the first theme.
      // Include a safety guard so we don't loop forever if generation keeps returning 0 posts.
      let extraAttempts = 0;
      const maxExtraAttempts = 5;
      while (
        examplePosts.length < exampleCount &&
        (config.themes?.length || 0) > 0 &&
        extraAttempts < maxExtraAttempts
      ) {
        const additionalContent = await generateInstagramContent(campaign.brand.name, {
          brandId: campaign.brandId,
          count: 1,
          theme: (config.themes || [])[0],
          style: config.style,
          campaignId: campaign.id,
          imageProvider: config.imageProvider,
        });

        if (!additionalContent.length) {
          extraAttempts++;
          continue;
        }

        examplePosts.push(...additionalContent);
        extraAttempts++;
      }

      if (!examplePosts.length) {
        throw new APIError(
          'Failed to generate any preview content for campaign',
          'CAMPAIGN_PREVIEW_NO_CONTENT',
          400,
          { campaignId }
        );
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
          logger.error('Attempting to save content with empty caption', {
            campaignId,
            post,
          });
          throw new APIError(
            'Cannot save content with empty caption',
            'CAMPAIGN_EMPTY_PREVIEW_CAPTION',
            400,
            { campaignId }
          );
        }

        const savedPost = await prisma.content.create({
          data: {
            caption: post.caption,
            hashtags: extractHashtagsFromCaption(post.caption),
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

        // Synchronous asset import via assets service to ensure media is attached
        if (post.imageUrl && post.imageMetadata) {
          const contentId = savedPost.id;
          const { imageUrl, imageMetadata } = post;

          try {
            const asset = await resolveGeneratedImageAsset(imageUrl, imageMetadata, {
              contentId,
              brandId: campaign.brandId,
              campaignId: campaign.id,
            });
            await attachAssetToContent({ contentId, asset });
            logger.info('[CampaignPreview] Asset imported for content', {
              campaignId: campaign.id,
              contentId,
              assetId: asset.id,
            });
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.warn(
              '[CampaignPreview] Failed to import asset for content; leaving post without media',
              {
                campaignId: campaign.id,
                contentId,
                error: { name: err.name, message: err.message },
              }
            );
          }
        }

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
      logger.error('Campaign preview error', { campaignId, userId, error });
      throw error instanceof APIError
        ? error
        : new APIError(
            error instanceof Error ? error.message : 'Failed to generate campaign preview',
            'CAMPAIGN_PREVIEW_FAILED',
            500,
            { campaignId, userId }
          );
    }
  }

  /**
   * Validate campaign configuration
   */
  validateCampaignConfig(config: CampaignConfig): string[] {
    const errors: string[] = [];

    // Campaign name is now optional (auto-generated if not provided)
    // Only validate length if a name is provided
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

    if (!isValidCampaignFrequency(config.frequency)) {
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
}

export const campaignCreationService = new CampaignCreationService();
