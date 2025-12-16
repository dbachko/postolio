import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();

export interface SchedulingConflict {
  conflictingCampaignId: string;
  conflictType: 'time_overlap' | 'resource_limit' | 'brand_overlap';
  conflictingTimes: Date[];
  severity: 'low' | 'medium' | 'high';
  details: string;
}

export interface ConflictResolution {
  strategy: 'suggest_alternative_time' | 'defer_campaign' | 'reduce_frequency';
  adjustedPostingTime?: string;
  adjustedDates?: Date[];
  message: string;
}

export interface CampaignConflictCheckInput {
  name?: string; // Optional: Auto-generated if not provided
  brandId: string;
  config: {
    duration: { start: string; end: string };
    frequency: string;
    postingTime: string;
    themes?: string[];
  };
}

export class CampaignCoordinationService {
  /**
   * Detect scheduling conflicts between a new campaign and existing active campaigns
   */
  async detectSchedulingConflicts(
    newCampaignConfig: CampaignConflictCheckInput,
    userId: string
  ): Promise<SchedulingConflict[]> {
    const conflicts: SchedulingConflict[] = [];

    // Get all active campaigns for the user
    const activeCampaigns = await prisma.campaign.findMany({
      where: {
        brand: { userId },
        status: { in: ['active', 'preview'] },
      },
      include: { brand: true },
    });

    const newStartDate = new Date(newCampaignConfig.config.duration.start);
    const newEndDate = new Date(newCampaignConfig.config.duration.end);
    const newPostingTime = newCampaignConfig.config.postingTime;

    type ExistingConfig = {
      duration?: { start?: string | Date; end?: string | Date };
      postingTime?: string;
    };
    const asExistingConfig = (val: unknown): ExistingConfig =>
      val && typeof val === 'object' ? (val as ExistingConfig) : {};

    for (const existingCampaign of activeCampaigns) {
      const existingConfig = asExistingConfig(existingCampaign.config);
      const existingStartDate = new Date(existingConfig.duration?.start || newStartDate);
      const existingEndDate = new Date(existingConfig.duration?.end || newEndDate);
      const existingPostingTime = existingConfig.postingTime;

      // Check for time overlap
      const hasTimeOverlap = newStartDate <= existingEndDate && newEndDate >= existingStartDate;
      const hasSamePostingTime = newPostingTime === existingPostingTime;

      if (
        hasTimeOverlap &&
        hasSamePostingTime &&
        existingConfig.duration?.start &&
        existingConfig.duration.end
      ) {
        const conflictingDates = this.getOverlappingPostDates(newCampaignConfig.config, {
          duration: {
            start: existingConfig.duration.start,
            end: existingConfig.duration.end,
          },
        });

        conflicts.push({
          conflictingCampaignId: existingCampaign.id,
          conflictType: 'time_overlap',
          conflictingTimes: conflictingDates,
          severity: this.calculateConflictSeverity(conflictingDates.length),
          details: `Posting time conflict with "${existingCampaign.name}" at ${existingPostingTime}`,
        });
      }

      // Check for brand overlap (same brand, overlapping dates)
      if (newCampaignConfig.brandId === existingCampaign.brandId && hasTimeOverlap) {
        conflicts.push({
          conflictingCampaignId: existingCampaign.id,
          conflictType: 'brand_overlap',
          conflictingTimes: [],
          severity: 'high',
          details: `Same brand already has active campaign "${existingCampaign.name}"`,
        });
      }
    }

    return conflicts;
  }

  /**
   * Get overlapping post dates between two campaign configurations
   */
  private getOverlappingPostDates(
    config1: { duration: { start: string | Date; end: string | Date } },
    config2: { duration: { start: string | Date; end: string | Date } }
  ): Date[] {
    const overlappingDates: Date[] = [];

    // For simplicity, assume daily frequency creates posts every day at posting time
    const start1 = new Date(config1.duration.start);
    const end1 = new Date(config1.duration.end);
    const start2 = new Date(config2.duration.start);
    const end2 = new Date(config2.duration.end);

    const overlapStart = new Date(Math.max(start1.getTime(), start2.getTime()));
    const overlapEnd = new Date(Math.min(end1.getTime(), end2.getTime()));

    if (overlapStart <= overlapEnd) {
      // Generate daily dates in overlap period (simplified)
      for (
        let date = new Date(overlapStart);
        date <= overlapEnd;
        date.setDate(date.getDate() + 1)
      ) {
        overlappingDates.push(new Date(date));
      }
    }

    return overlappingDates;
  }

  /**
   * Calculate conflict severity based on number of conflicting posts
   */
  private calculateConflictSeverity(conflictCount: number): 'low' | 'medium' | 'high' {
    if (conflictCount <= 2) return 'low';
    if (conflictCount <= 5) return 'medium';
    return 'high';
  }
}

export const campaignCoordinationService = new CampaignCoordinationService();
