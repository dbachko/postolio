/**
 * Autopilot Service - Refactored to use AWS EventBridge Scheduler
 * Removed node-cron dependency, now triggered by EventBridge rules
 */

import { PrismaClient } from '@prisma/client';
import { generateInstagramContent, type ContentGenerationRequest } from './content-generator.js';
import { analyzeBrandStyle } from './ai.js';
import { schedulerService } from './scheduler.js';

const prisma = new PrismaClient();

export interface AutopilotConfig {
  enabled: boolean;
  minDaysAhead: number;
  maxContentPerGeneration: number;
  contentStrategy?: {
    themes?: string[];
    postingFrequency?: 'daily' | 'every-other-day' | 'weekly';
    optimalTimes?: { hour: number; minute: number }[];
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
  async runAutopilotGeneration(): Promise<{ totalGenerated: number; gaps: ContentGap[] }> {
    try {
      // 1. Detect content gaps for all active brands
      const gaps = await this.detectContentGaps();
      console.log(`Found ${gaps.length} brands with content gaps`);

      let totalGenerated = 0;

      // 2. Generate content for each brand with gaps
      for (const gap of gaps) {
        try {
          const generated = await this.generateContentForBrand(gap);
          totalGenerated += generated;
          console.log(`Generated ${generated} posts for brand: ${gap.brandName}`);
        } catch (error) {
          console.error(`Failed to generate content for brand ${gap.brandName}:`, error);
        }
      }

      console.log(`Autopilot generation complete. Total generated: ${totalGenerated}`);
      return { totalGenerated, gaps };
    } catch (error) {
      console.error('Autopilot generation failed:', error);
      throw error;
    }
  }

  /**
   * Lambda handler for EventBridge trigger
   * This will be called by AWS Lambda when triggered by EventBridge
   */
  async handleEventBridgeTrigger(event: any): Promise<any> {
    console.log('Autopilot triggered by EventBridge:', event);
    
    const result = await this.runAutopilotGeneration();
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Autopilot generation completed',
        totalGenerated: result.totalGenerated,
        gaps: result.gaps.length,
      }),
    };
  }

  /**
   * Manual trigger for autopilot generation
   */
  async triggerManual(): Promise<{ success: boolean; message: string; generated: number }> {
    try {
      console.log('Manual autopilot trigger initiated...');
      const result = await this.runAutopilotGeneration();
      return {
        success: true,
        message: 'Autopilot generation completed successfully',
        generated: result.totalGenerated,
      };
    } catch (error) {
      console.error('Manual autopilot trigger failed:', error);
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
    const targetDaysAhead = 14;

    try {
      // Get all brands that have Instagram integration
      const brands = await prisma.brand.findMany({
        where: {
          OR: [{ instagramAccessToken: { not: null } }, { instagramPageId: { not: null } }],
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
      console.error('Error detecting content gaps:', error);
      return [];
    }
  }

  /**
   * Analyze content gap for a specific brand
   */
  private async analyzeContentGap(brand: any, targetDaysAhead: number): Promise<ContentGap> {
    const now = new Date();
    const targetDate = new Date(now.getTime() + targetDaysAhead * 24 * 60 * 60 * 1000);

    // Get brand's content strategy or default
    const strategy = brand.preferences?.contentStrategy || {
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

      // Get brand's style profile
      let styleProfile = brand.styleProfile as any;
      if (!styleProfile) {
        // Generate style profile if missing
        console.log(`Generating style profile for brand: ${brand.name}`);
        const analysisResult = await analyzeBrandStyle([], brand.name);
        styleProfile = analysisResult.styleProfile;

        await prisma.brand.update({
          where: { id: brand.id },
          data: { styleProfile },
        });
      }

      // Get content strategy
      const strategy = (brand.preferences as any)?.contentStrategy || {
        themes: ['lifestyle', 'inspiration', 'behind-the-scenes'],
        postingFrequency: 'daily',
      };

      // Generate content requests
      const contentRequests: ContentGenerationRequest[] = [];
      const postsToGenerate = Math.min(gap.missingDays, 7); // Generate max 7 posts at a time

      for (let i = 0; i < postsToGenerate; i++) {
        const theme = strategy.themes?.[i % strategy.themes.length] || 'lifestyle';
        contentRequests.push({
          brandId: gap.brandId,
          count: 1,
          theme,
          style: styleProfile.aestheticStyle || 'modern',
        });
      }

      // Generate content
      let totalGenerated = 0;
      for (const request of contentRequests) {
        try {
          const generatedContent = await generateInstagramContent(styleProfile, brand.name, request);

          // Save generated content to database
          for (const content of generatedContent) {
            await prisma.content.create({
              data: {
                caption: content.caption,
                imageUrl: content.imageUrl ?? null,
                s3ImageKey: content.s3ImageKey ?? null,
                cdnImageUrl: content.cdnImageUrl ?? null,
                imageRegion: content.imageRegion ?? null,
                retentionExpiresAt: content.retentionExpiresAt ?? null,
                hashtags: content.hashtags,
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
            totalGenerated++;
          }
        } catch (error) {
          console.error(`Failed to generate content batch for brand ${brand.name}:`, error);
        }
      }

      // Auto-schedule the generated content
      if (totalGenerated > 0) {
        await this.scheduleGeneratedContent(gap.brandId, strategy);
      }

      return totalGenerated;
    } catch (error) {
      console.error(`Error generating content for brand ${gap.brandId}:`, error);
      return 0;
    }
  }

  /**
   * Auto-schedule generated content based on brand strategy
   */
  private async scheduleGeneratedContent(brandId: string, strategy: any): Promise<void> {
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

      // Determine posting frequency
      let hoursInterval = 24; // daily
      if (strategy.postingFrequency === 'every-other-day') {
        hoursInterval = 48;
      } else if (strategy.postingFrequency === 'weekly') {
        hoursInterval = 168;
      }

      // Find the next available time slot
      let nextScheduleTime = await this.getNextAvailableSlot(brandId);

      // Schedule each piece of content using the new scheduler
      for (const content of unscheduledContent) {
        await schedulerService.scheduleContent(content.id, nextScheduleTime);

        // Move to next slot
        nextScheduleTime = new Date(nextScheduleTime.getTime() + hoursInterval * 60 * 60 * 1000);
      }

      console.log(`Scheduled ${unscheduledContent.length} autopilot posts for brand ${brandId}`);
    } catch (error) {
      console.error('Error scheduling generated content:', error);
    }
  }

  /**
   * Find the next available scheduling slot for a brand
   */
  private async getNextAvailableSlot(brandId: string): Promise<Date> {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0); // Default to 9 AM

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

    // Schedule at least 4 hours after the last post
    const nextSlot = new Date(lastScheduled.scheduledAt.getTime() + 4 * 60 * 60 * 1000);
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
          OR: [{ instagramAccessToken: { not: null } }, { instagramPageId: { not: null } }],
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
          const gap = await this.analyzeContentGap(brand, 14);
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
      console.error('Error getting autopilot status:', error);
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

      const updatedPrefs = {
        ...((currentPrefs?.preferences as any) || {}),
        autopilot: {
          ...((currentPrefs?.preferences as any)?.autopilot || {}),
          ...config,
        },
      };

      await prisma.brand.update({
        where: { id: brandId },
        data: { preferences: updatedPrefs },
      });

      return true;
    } catch (error) {
      console.error('Error updating autopilot config:', error);
      return false;
    }
  }
}

export const autopilotService = new AutopilotService();