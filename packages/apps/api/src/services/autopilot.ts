/**
 * Autopilot Service - Refactored to use AWS EventBridge Scheduler
 * Removed node-cron dependency, now triggered by EventBridge rules
 */

import { logger as baseLogger } from '@postolio/logger';
import { generateInstagramContent, type ContentGenerationRequest } from './content-generator.js';
import { resolveGeneratedImageAsset, attachAssetToContent } from './assets-media.js';
import { schedulerService } from './scheduler.js';
import {
  SCHEDULER_TIME_INTERVALS,
  SCHEDULER_LIMITS,
  getPostingIntervalMs,
} from '../constants/scheduler.js';
import type { EventBridgeScheduledEvent, LambdaResponse } from '../types/aws-events.js';
import { getDatabaseClient } from '../config/database.js';
import { extractHashtagsFromCaption } from '../utils/hashtag-extractor.js';

const prisma = getDatabaseClient();
const autopilotLogger = baseLogger.child({ module: 'autopilot-service' });

export interface AutopilotConfig {
  enabled: boolean;
  minDaysAhead: number;
  maxContentPerGeneration: number;
  contentStrategy?: {
    themes?: string[];
    postingFrequency?: 'daily' | 'every-other-day' | 'weekly';
    optimalTimes?: Array<{ hour: number; minute: number }>;
  };
}

export interface ContentGap {
  brandId: string;
  brandName: string;
  missingDays: number;
  nextScheduledDate: Date | null;
  lastScheduledDate: Date | null;
}

class AutopilotService {
  /**
   * Run autopilot generation - This will be triggered by EventBridge
   * instead of node-cron
   */
  async runAutopilotGeneration(): Promise<{
    totalGenerated: number;
    gaps: ContentGap[];
  }> {
    try {
      // 1. Detect content gaps for all active brands
      const gaps = await this.detectContentGaps();
      autopilotLogger.info('Detected content gaps for brands', { gapCount: gaps.length });

      let totalGenerated = 0;

      // 2. Generate content for each brand with gaps
      for (const gap of gaps) {
        try {
          const generated = await this.generateContentForBrand(gap);
          totalGenerated += generated;
          autopilotLogger.info('Generated content for brand', {
            brandId: gap.brandId,
            brandName: gap.brandName,
            generatedCount: generated,
          });
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          autopilotLogger.error('Failed to generate content for brand', {
            brandId: gap.brandId,
            brandName: gap.brandName,
            error: { name: err.name, message: err.message, stack: err.stack },
          });
        }
      }

      autopilotLogger.info('Autopilot generation run completed', {
        totalGenerated,
        gapCount: gaps.length,
      });
      return { totalGenerated, gaps };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      autopilotLogger.error('Autopilot generation failed', {
        error: { name: err.name, message: err.message, stack: err.stack },
      });
      throw error;
    }
  }

  /**
   * Lambda handler for EventBridge trigger
   * This will be called by AWS Lambda when triggered by EventBridge
   */
  async handleEventBridgeTrigger(event: EventBridgeScheduledEvent): Promise<LambdaResponse> {
    autopilotLogger.info('Autopilot triggered by EventBridge', {
      eventId: event.id,
      time: event.time,
      detailType: event['detail-type'],
      taskType: event.detail?.taskType,
    });

    const result = await this.runAutopilotGeneration();

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Autopilot generation completed',
        totalGenerated: result.totalGenerated,
        gaps: result.gaps.length,
        eventId: event.id,
        executionTime: event.time,
      }),
    };
  }

  /**
   * Manual trigger for autopilot generation
   */
  async triggerManual(): Promise<{
    success: boolean;
    message: string;
    generated: number;
  }> {
    try {
      autopilotLogger.info('Manual autopilot trigger initiated');
      const result = await this.runAutopilotGeneration();
      return {
        success: true,
        message: 'Autopilot generation completed successfully',
        generated: result.totalGenerated,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      autopilotLogger.error('Manual autopilot trigger failed', {
        error: { name: err.name, message: err.message, stack: err.stack },
      });
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        generated: 0,
      };
    }
  }

  /**
   * Detect content gaps for all active brands
   */
  private async detectContentGaps(): Promise<ContentGap[]> {
    const gaps: ContentGap[] = [];
    const targetDaysAhead = SCHEDULER_LIMITS.TARGET_DAYS_AHEAD;

    try {
      // Get all brands that have Instagram integration
      const brands = await prisma.brand.findMany({
        where: {
          socialAccounts: {
            some: {
              platform: 'instagram',
            },
          },
        },
        include: {
          content: {
            where: {
              status: { in: ['scheduled', 'published'] },
              scheduledAt: { not: null },
            },
            orderBy: { scheduledAt: 'desc' },
          },
        },
      });

      for (const brand of brands) {
        const gap = await this.analyzeContentGap(brand, targetDaysAhead);
        if (gap.missingDays > 0) {
          gaps.push(gap);
        }
      }

      return gaps;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      autopilotLogger.error('Error detecting content gaps', {
        error: { name: err.name, message: err.message, stack: err.stack },
      });
      return [];
    }
  }

  /**
   * Analyze content gap for a specific brand
   */
  private async analyzeContentGap(
    brand: {
      id: string;
      name: string;
      preferences?: unknown;
      content?: Array<{ scheduledAt: Date | null }>;
      styleProfile?: unknown;
    },
    targetDaysAhead: number
  ): Promise<ContentGap> {
    const now = new Date();
    const targetDate = new Date(now.getTime() + targetDaysAhead * 24 * 60 * 60 * 1000);

    // Get brand's content strategy or default
    const prefsObj = (brand.preferences as Record<string, unknown> | null | undefined) || undefined;
    const rawStrategy =
      prefsObj && typeof prefsObj === 'object' && 'contentStrategy' in prefsObj
        ? (prefsObj.contentStrategy as unknown)
        : undefined;
    const contentStrategy = (
      rawStrategy && typeof rawStrategy === 'object'
        ? (rawStrategy as {
            postingFrequency?: 'daily' | 'every-other-day' | 'weekly';
            themes?: string[];
          })
        : undefined
    ) as
      | {
          postingFrequency?: 'daily' | 'every-other-day' | 'weekly';
          themes?: string[];
        }
      | undefined;
    const strategy = contentStrategy || {
      postingFrequency: 'daily',
      themes: ['lifestyle', 'inspiration', 'behind-the-scenes'],
    };

    // Calculate expected posts based on frequency
    let expectedPostsPerWeek = 7; // daily
    if (strategy.postingFrequency === 'every-other-day') {
      expectedPostsPerWeek = 3.5;
    } else if (strategy.postingFrequency === 'weekly') {
      expectedPostsPerWeek = 1;
    }

    const expectedTotalPosts = Math.ceil((targetDaysAhead / 7) * expectedPostsPerWeek);

    // Count scheduled content within target period
    const scheduledContent = await prisma.content.count({
      where: {
        brandId: brand.id,
        status: { in: ['scheduled', 'published'] },
        scheduledAt: {
          gte: now,
          lte: targetDate,
        },
      },
    });

    const missingPosts = Math.max(0, expectedTotalPosts - scheduledContent);

    // Find last scheduled date
    const lastScheduled = await prisma.content.findFirst({
      where: {
        brandId: brand.id,
        scheduledAt: { not: null },
      },
      orderBy: { scheduledAt: 'desc' },
    });

    // Find next scheduled date after now
    const nextScheduled = await prisma.content.findFirst({
      where: {
        brandId: brand.id,
        scheduledAt: { gte: now },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    return {
      brandId: brand.id,
      brandName: brand.name,
      missingDays: missingPosts,
      lastScheduledDate: lastScheduled?.scheduledAt ?? null,
      nextScheduledDate: nextScheduled?.scheduledAt ?? null,
    };
  }

  /**
   * Generate content for a specific brand with gaps
   */
  private async generateContentForBrand(gap: ContentGap): Promise<number> {
    try {
      const brand = await prisma.brand.findUnique({
        where: { id: gap.brandId },
        include: { user: true },
      });

      if (!brand) {
        throw new Error(`Brand not found: ${gap.brandId}`);
      }

      // Get content strategy
      const prefs = brand.preferences as Record<string, unknown> | null | undefined;
      const rawStrategy2 =
        prefs && typeof prefs === 'object' && 'contentStrategy' in prefs
          ? (prefs.contentStrategy as unknown)
          : undefined;
      const contentStrategy =
        rawStrategy2 && typeof rawStrategy2 === 'object'
          ? (rawStrategy2 as {
              themes?: string[];
              postingFrequency?: 'daily' | 'every-other-day' | 'weekly';
            })
          : undefined;
      const strategy = contentStrategy || {
        themes: ['lifestyle', 'inspiration', 'behind-the-scenes'],
        postingFrequency: 'daily',
      };

      // Generation uses brand profile projection context internally

      // Generate content requests
      const contentRequests: ContentGenerationRequest[] = [];
      const postsToGenerate = Math.min(
        gap.missingDays,
        SCHEDULER_LIMITS.MAX_AUTOPILOT_POSTS_PER_RUN
      );

      for (let i = 0; i < postsToGenerate; i++) {
        const theme = strategy.themes?.[i % strategy.themes.length] || 'lifestyle';
        contentRequests.push({ brandId: gap.brandId, count: 1, theme });
      }

      // Generate content
      let totalGenerated = 0;
      for (const request of contentRequests) {
        try {
          const generatedContent = await generateInstagramContent(brand.name, request);

          // Save generated content to database
          for (const content of generatedContent) {
            const created = await prisma.content.create({
              data: {
                caption: content.caption,
                hashtags: extractHashtagsFromCaption(content.caption),
                status: 'scheduled', // Auto-schedule autopilot content
                brandId: gap.brandId,
                generationParams: {
                  source: 'autopilot',
                  theme: request.theme,
                  style: request.style,
                  generatedAt: new Date().toISOString(),
                },
              },
            });

            // Synchronous asset import via assets service to ensure media is attached
            if (content.imageUrl && content.imageMetadata) {
              const contentId = created.id;
              const { imageUrl, imageMetadata } = content;

              try {
                const asset = await resolveGeneratedImageAsset(imageUrl, imageMetadata, {
                  contentId,
                  brandId: gap.brandId,
                });
                await attachAssetToContent({ contentId, asset });
                autopilotLogger.info(`[Autopilot] Asset imported for content ${contentId}`, {
                  brandId: gap.brandId,
                  assetId: asset.id,
                });
              } catch (error) {
                autopilotLogger.error(
                  `[Autopilot] Failed to import asset for content ${contentId}; leaving post without media`,
                  {
                    brandId: gap.brandId,
                    error:
                      error instanceof Error
                        ? { name: error.name, message: error.message }
                        : String(error),
                  }
                );
              }
            }

            totalGenerated++;
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          autopilotLogger.error('Failed to generate content batch', {
            brandId: brand.id,
            brandName: brand.name,
            error: { name: err.name, message: err.message, stack: err.stack },
          });
        }
      }

      // Auto-schedule the generated content
      if (totalGenerated > 0) {
        await this.scheduleGeneratedContent(gap.brandId, strategy);
      }

      return totalGenerated;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      autopilotLogger.error('Error generating content for brand', {
        brandId: gap.brandId,
        error: { name: err.name, message: err.message, stack: err.stack },
      });
      return 0;
    }
  }

  /**
   * Auto-schedule generated content based on brand strategy
   */
  private async scheduleGeneratedContent(
    brandId: string,
    strategy: { postingFrequency?: 'daily' | 'every-other-day' | 'weekly' }
  ): Promise<void> {
    try {
      // Get unscheduled draft content for this brand
      const unscheduledContent = await prisma.content.findMany({
        where: {
          brandId,
          status: 'draft',
          scheduledAt: null,
          generationParams: {
            path: ['source'],
            equals: 'autopilot',
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      if (unscheduledContent.length === 0) {
        return;
      }

      // Determine posting interval based on frequency
      const intervalMs = getPostingIntervalMs(strategy.postingFrequency || 'daily');

      // Find the next available time slot
      let nextScheduleTime = await this.getNextAvailableSlot(brandId);

      // Schedule each piece of content using the new scheduler
      for (const content of unscheduledContent) {
        await schedulerService.scheduleContent(content.id, nextScheduleTime);

        // Move to next slot
        nextScheduleTime = new Date(nextScheduleTime.getTime() + intervalMs);
      }

      autopilotLogger.info('Scheduled autopilot posts for brand', {
        brandId,
        scheduledCount: unscheduledContent.length,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      autopilotLogger.error('Error scheduling generated content', {
        brandId,
        error: { name: err.name, message: err.message, stack: err.stack },
      });
    }
  }

  /**
   * Find the next available scheduling slot for a brand
   */
  private async getNextAvailableSlot(brandId: string): Promise<Date> {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(SCHEDULER_LIMITS.DEFAULT_POSTING_HOUR, 0, 0, 0);

    // Find the last scheduled post
    const lastScheduled = await prisma.content.findFirst({
      where: {
        brandId,
        scheduledAt: { gte: now },
      },
      orderBy: { scheduledAt: 'desc' },
    });

    if (!lastScheduled?.scheduledAt) {
      return tomorrow;
    }

    // Schedule with minimum interval after the last post
    const nextSlot = new Date(
      lastScheduled.scheduledAt.getTime() + SCHEDULER_TIME_INTERVALS.MIN_POST_INTERVAL_MS
    );
    return nextSlot > tomorrow ? nextSlot : tomorrow;
  }

  /**
   * Get autopilot status for all brands
   */
  async getAutopilotStatus(): Promise<{
    brandStatuses: Array<{
      brandId: string;
      brandName: string;
      scheduledCount: number;
      nextPost: Date | null;
      gapDays: number;
    }>;
  }> {
    try {
      const brands = await prisma.brand.findMany({
        where: {
          socialAccounts: {
            some: {
              platform: 'instagram',
            },
          },
        },
        include: {
          content: {
            where: {
              scheduledAt: { gte: new Date() },
            },
            orderBy: { scheduledAt: 'asc' },
          },
        },
      });

      const brandStatuses = await Promise.all(
        brands.map(async (brand) => {
          const gap = await this.analyzeContentGap(
            {
              id: brand.id,
              name: brand.name,
              preferences: brand.preferences,
              styleProfile: brand.styleProfile,
              content: brand.content,
            },
            SCHEDULER_LIMITS.TARGET_DAYS_AHEAD
          );
          const nextPost = brand.content[0]?.scheduledAt ?? null;

          return {
            brandId: brand.id,
            brandName: brand.name,
            scheduledCount: brand.content.length,
            nextPost,
            gapDays: gap.missingDays,
          };
        })
      );

      return {
        brandStatuses,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      autopilotLogger.error('Error getting autopilot status', {
        error: { name: err.name, message: err.message, stack: err.stack },
      });
      return {
        brandStatuses: [],
      };
    }
  }

  /**
   * Update autopilot configuration for a brand
   */
  async updateBrandConfig(brandId: string, config: Partial<AutopilotConfig>): Promise<boolean> {
    try {
      const currentPrefs = await prisma.brand.findUnique({
        where: { id: brandId },
        select: { preferences: true },
      });

      const existingPrefs = currentPrefs?.preferences as Record<string, unknown> | null | undefined;
      const existingAutopilot =
        existingPrefs && typeof existingPrefs === 'object' && 'autopilot' in existingPrefs
          ? (existingPrefs.autopilot as unknown)
          : undefined;
      const updatedPrefsObj = {
        ...(existingPrefs || {}),
        autopilot: {
          ...(existingAutopilot || {}),
          ...config,
        },
      };

      await prisma.brand.update({
        where: { id: brandId },
        data: { preferences: JSON.parse(JSON.stringify(updatedPrefsObj)) },
      });

      return true;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      autopilotLogger.error('Error updating autopilot config', {
        brandId,
        error: { name: err.name, message: err.message, stack: err.stack },
      });
      return false;
    }
  }
}

export const autopilotService = new AutopilotService();
