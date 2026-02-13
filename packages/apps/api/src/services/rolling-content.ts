import { logger as baseLogger } from '@postolio/logger';
import { generateInstagramContent, type ContentGenerationRequest } from './content-generator.js';
import { resolveGeneratedImageAsset, attachAssetToContent } from './assets-media.js';
import { schedulerService } from './scheduler.js';
import { getDatabaseClient } from '../config/database.js';
import { formatError } from '../utils/logging.js';
import { extractHashtagsFromCaption } from '../utils/hashtag-extractor.js';

const prisma = getDatabaseClient();
const rollingLogger = baseLogger.child({ module: 'rolling-content' });

export interface QueueStatus {
  totalScheduled: number;
  daysAhead: number;
  needsGeneration: boolean;
  minQueueSize: number;
  maxQueueSize: number;
}

export interface RollingGenerationConfig {
  minQueueSize: number; // Minimum days ahead to maintain (e.g., 7)
  maxQueueSize: number; // Maximum days ahead to generate (e.g., 14)
  targetQueueSize: number; // Target queue size (e.g., 10)
  batchSize: number; // How many posts to generate at once (e.g., 3)
}

const DEFAULT_CONFIG: RollingGenerationConfig = {
  minQueueSize: 7, // Always maintain 7 days ahead
  maxQueueSize: 14, // Never generate more than 14 days ahead
  targetQueueSize: 10, // Target 10 days ahead
  batchSize: 3, // Generate 3 posts at a time
};

class RollingContentService {
  private isProcessing = new Set<string>();

  private async ensureRollingSeries(brandId: string) {
    // Stable container so rolling-generated posts are grouped in the calendar.
    return await prisma.contentSeries.upsert({
      where: { brandId_key: { brandId, key: 'rolling_generation' } },
      update: {
        name: 'Rolling Pipeline',
        kind: 'rolling',
        status: 'active',
        generatorJson: { source: 'rolling_generation' },
        rollingConfigJson: DEFAULT_CONFIG as any,
      },
      create: {
        brandId,
        key: 'rolling_generation',
        name: 'Rolling Pipeline',
        description: 'System-managed rolling content pipeline.',
        color: null,
        kind: 'rolling',
        status: 'active',
        generatorJson: { source: 'rolling_generation' },
        rollingConfigJson: DEFAULT_CONFIG as any,
      },
      select: { id: true },
    });
  }

  /**
   * Trigger rolling content generation after a post is published
   */
  async onPostPublished(contentId: string): Promise<void> {
    try {
      // Get the published content with brand info
      const content = await prisma.content.findUnique({
        where: { id: contentId },
        include: {
          brand: true,
        },
      });

      if (!content || !content.brand) {
        rollingLogger.info(`Content ${contentId} or brand not found for rolling generation`);
        return;
      }

      rollingLogger.info(
        `Post published for ${content.brand.name}, checking rolling generation needs...`
      );

      // Check if we need to generate more content
      await this.checkAndGenerateContent(content.brandId);
    } catch (error) {
      rollingLogger.error('Error in rolling content generation', formatError(error));
    }
  }

  /**
   * Check content queue status and generate if needed
   */
  async checkAndGenerateContent(brandId: string): Promise<void> {
    // Prevent multiple simultaneous generations for the same brand
    if (this.isProcessing.has(brandId)) {
      rollingLogger.info(`Rolling generation already in progress for brand: ${brandId}`);
      return;
    }

    try {
      this.isProcessing.add(brandId);

      // Check queue status
      const queueStatus = await this.checkContentQueue(brandId);

      rollingLogger.info(`Queue status for brand ${brandId}`, {
        totalScheduled: queueStatus.totalScheduled,
        daysAhead: queueStatus.daysAhead,
        needsGeneration: queueStatus.needsGeneration,
        minRequired: queueStatus.minQueueSize,
      });

      if (!queueStatus.needsGeneration) {
        rollingLogger.info(
          `Brand ${brandId} has sufficient content (${queueStatus.daysAhead} days ahead)`
        );
        return;
      }

      // Generate content to fill the gap
      await this.generateAndScheduleContent(brandId, queueStatus);
    } finally {
      this.isProcessing.delete(brandId);
    }
  }

  /**
   * Check content queue status for a brand
   */
  private async checkContentQueue(brandId: string, config = DEFAULT_CONFIG): Promise<QueueStatus> {
    const now = new Date();
    const maxDate = new Date(now.getTime() + config.maxQueueSize * 24 * 60 * 60 * 1000);

    // Get all scheduled content for this brand in the next maxQueueSize days
    const scheduledContent = await prisma.content.findMany({
      where: {
        brandId,
        status: { in: ['scheduled', 'published'] },
        scheduledAt: {
          gte: now,
          lte: maxDate,
        },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    const totalScheduled = scheduledContent.length;

    // Calculate days ahead (simple approximation)
    const lastContent = scheduledContent[scheduledContent.length - 1];
    const daysAhead =
      totalScheduled > 0 && lastContent?.scheduledAt
        ? Math.ceil((lastContent.scheduledAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
        : 0;

    return {
      totalScheduled,
      daysAhead,
      needsGeneration: daysAhead < config.minQueueSize,
      minQueueSize: config.minQueueSize,
      maxQueueSize: config.maxQueueSize,
    };
  }

  /**
   * Generate and schedule new content to maintain queue
   */
  private async generateAndScheduleContent(
    brandId: string,
    queueStatus: QueueStatus
  ): Promise<void> {
    try {
      // Get brand information and style profile
      const brand = await prisma.brand.findUnique({
        where: { id: brandId },
        select: {
          id: true,
          name: true,
          preferences: true,
        },
      });

      if (!brand) {
        throw new Error(`Brand ${brandId} not found`);
      }

      let themes = ['lifestyle', 'inspiration', 'behind-the-scenes']; // defaults
      let style = 'modern'; // default
      // Prefer brand-level content strategy (if configured).
      const prefsRaw = brand.preferences as unknown;
      let prefs: { themes?: string[]; style?: string } | undefined;
      if (prefsRaw && typeof prefsRaw === 'object' && 'contentStrategy' in prefsRaw) {
        const maybeRecord = prefsRaw as Record<string, unknown>;
        const contentStrategyVal = maybeRecord.contentStrategy;
        if (contentStrategyVal && typeof contentStrategyVal === 'object') {
          const csObj = contentStrategyVal as {
            themes?: unknown;
            style?: unknown;
          };
          const themesVal = Array.isArray(csObj.themes)
            ? csObj.themes.filter((t): t is string => typeof t === 'string')
            : undefined;
          const styleVal = typeof csObj.style === 'string' ? csObj.style : undefined;
          prefs = { themes: themesVal, style: styleVal };
        }
      }
      if (prefs) {
        themes = prefs.themes || themes;
        style = prefs.style || style;
      }
      rollingLogger.info('Using brand preferences for rolling generation');

      // Get or generate style profile

      // Calculate how many posts to generate
      const postsNeeded = Math.min(
        DEFAULT_CONFIG.batchSize,
        DEFAULT_CONFIG.targetQueueSize - queueStatus.daysAhead
      );

      rollingLogger.info(`Generating ${postsNeeded} posts for brand: ${brand.name}`);

      // Generate content
      const generatedContent = [];
      for (let i = 0; i < postsNeeded; i++) {
        const theme = themes[i % themes.length];

        const contentRequest: ContentGenerationRequest = {
          brandId,
          count: 1,
          theme,
          style,
        };

        const content = await generateInstagramContent(brand.name, contentRequest);
        generatedContent.push(...content);
      }

      // Save and schedule the generated content
      const rollingSeries = await this.ensureRollingSeries(brandId);
      for (const content of generatedContent) {
        // Save to database
        const savedContent = await prisma.content.create({
          data: {
            caption: content.caption,
            hashtags: extractHashtagsFromCaption(content.caption),
            brandId,
            contentSeriesId: rollingSeries.id,
            status: 'scheduled', // Auto-schedule rolling content
            generationParams: {
              source: 'rolling_generation',
              theme: content.imagePrompt || 'lifestyle',
              style,
              generatedAt: new Date().toISOString(),
              rollingGeneration: true,
            },
          },
        });

        // Synchronous asset import via assets service to ensure media is attached
        if (content.imageUrl && content.imageMetadata) {
          const contentId = savedContent.id;
          const { imageUrl, imageMetadata } = content;

          try {
            const asset = await resolveGeneratedImageAsset(imageUrl, imageMetadata, {
              contentId,
              brandId,
            });
            await attachAssetToContent({ contentId, asset });
            rollingLogger.info(`[RollingContent] Asset imported for content ${contentId}`, {
              brandId,
              assetId: asset.id,
            });
          } catch (error) {
            rollingLogger.error(
              `[RollingContent] Failed to import asset for content ${contentId}; leaving post without media`,
              {
                brandId,
                error:
                  error instanceof Error
                    ? { name: error.name, message: error.message }
                    : String(error),
              }
            );
          }
        }

        // Schedule the content
        const nextSlot = await this.getNextAvailableSlot(brandId);
        await schedulerService.scheduleContent(savedContent.id, nextSlot);

        rollingLogger.info(
          `Generated and scheduled rolling content: ${savedContent.id} for ${nextSlot.toISOString()}`
        );
      }

      rollingLogger.info(`Rolling generation complete for brand: ${brand.name}`);
    } catch (error) {
      rollingLogger.error('Error generating rolling content', formatError(error));
      throw error;
    }
  }

  /**
   * Find the next available scheduling slot for a brand
   */
  private async getNextAvailableSlot(brandId: string): Promise<Date> {
    const now = new Date();

    // Find the last scheduled post
    const lastScheduled = await prisma.content.findFirst({
      where: {
        brandId,
        scheduledAt: { gte: now },
      },
      orderBy: { scheduledAt: 'desc' },
    });

    if (!lastScheduled?.scheduledAt) {
      // No posts scheduled, start from tomorrow at 9 AM
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      return tomorrow;
    }

    // Schedule 24 hours after the last post (daily frequency)
    // In production, this should respect brand-level preferences and queue slots.
    const nextSlot = new Date(lastScheduled.scheduledAt.getTime() + 24 * 60 * 60 * 1000);

    // Ensure it's at a reasonable hour (9 AM to 8 PM)
    if (nextSlot.getHours() < 9) {
      nextSlot.setHours(9, 0, 0, 0);
    } else if (nextSlot.getHours() > 20) {
      nextSlot.setDate(nextSlot.getDate() + 1);
      nextSlot.setHours(9, 0, 0, 0);
    }

    return nextSlot;
  }

  /**
   * Manual trigger for rolling generation (for testing/debugging)
   */
  async triggerManual(
    brandId: string
  ): Promise<{ success: boolean; message: string; generated: number }> {
    try {
      const queueStatus = await this.checkContentQueue(brandId);

      if (!queueStatus.needsGeneration) {
        return {
          success: true,
          message: `Brand has sufficient content (${queueStatus.daysAhead} days ahead)`,
          generated: 0,
        };
      }

      await this.generateAndScheduleContent(brandId, queueStatus);

      return {
        success: true,
        message: `Rolling generation completed for brand ${brandId}`,
        generated: DEFAULT_CONFIG.batchSize,
      };
    } catch (error) {
      rollingLogger.error('Manual rolling generation failed', formatError(error));
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        generated: 0,
      };
    }
  }

  /**
   * Get queue status for a brand (for monitoring/debugging)
   */
  async getQueueStatus(brandId: string): Promise<QueueStatus> {
    return await this.checkContentQueue(brandId);
  }
}

export const rollingContentService = new RollingContentService();
