/**
 * Autopilot Service - Refactored to use AWS EventBridge Scheduler
 * Removed node-cron dependency, now triggered by EventBridge rules
 */

import { logger as baseLogger } from '@postolio/logger';
import { SCHEDULER_LIMITS } from '../constants/scheduler.js';
import type { EventBridgeScheduledEvent, LambdaResponse } from '../types/aws-events.js';
import { getDatabaseClient } from '../config/database.js';
import { generateContentForBrand as generateContentForBrandForGap } from './autopilot-generation.js';

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
    return generateContentForBrandForGap(gap);
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
