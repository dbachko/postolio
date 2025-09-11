import { PrismaClient } from '@postolio/database';

const prisma = new PrismaClient();

export interface SchedulingConflict {
  conflictingCampaignId: string;
  conflictType: 'time_overlap' | 'resource_limit' | 'brand_overlap';
  conflictingTimes: Date[];
  severity: 'low' | 'medium' | 'high';
  details: string;
}

export interface ConflictResolution {
  strategy:
    | 'adjust_lower_priority'
    | 'suggest_alternative_time'
    | 'defer_campaign'
    | 'reduce_frequency';
  adjustedPostingTime?: string;
  adjustedDates?: Date[];
  message: string;
}

export interface ResourceAllocation {
  campaigns: Array<{
    campaignId: string;
    priority: number;
    allocatedSlots: number;
    estimatedGenerationTime: number;
  }>;
  totalCapacity: number;
  utilizationRate: number;
}

export interface CampaignConfigWithPriority {
  name: string;
  brandId: string;
  config: {
    duration: { start: string; end: string };
    frequency: string;
    postingTime: string;
    themes?: string[];
  };
  priority: number;
}

export class CampaignCoordinationService {
  /**
   * Detect scheduling conflicts between a new campaign and existing active campaigns
   */
  async detectSchedulingConflicts(
    newCampaignConfig: CampaignConfigWithPriority,
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
   * Resolve scheduling conflicts using priority-based strategies
   */
  async resolveSchedulingConflict(
    newCampaign: CampaignConfigWithPriority,
    conflictingCampaign: CampaignConfigWithPriority,
    _userId: string
  ): Promise<ConflictResolution> {
    void _userId; // reserved for future auditing/logging
    // Higher priority = lower number (1 is highest priority)
    if (newCampaign.priority < conflictingCampaign.priority) {
      // New campaign has higher priority - suggest adjusting existing campaign
      return {
        strategy: 'adjust_lower_priority',
        adjustedPostingTime: this.suggestAlternativeTime(conflictingCampaign.config.postingTime),
        message: `Higher priority campaign detected. Suggest adjusting existing campaign posting time.`,
      };
    } else {
      // New campaign has lower priority - suggest adjustment
      return {
        strategy: 'suggest_alternative_time',
        adjustedPostingTime: this.suggestAlternativeTime(newCampaign.config.postingTime),
        message: `Conflict detected. Suggested alternative posting time to avoid overlap.`,
      };
    }
  }

  /**
   * Allocate AI generation resources across active campaigns
   */
  async allocateGenerationResources(userId: string): Promise<ResourceAllocation> {
    const activeCampaigns = await prisma.campaign.findMany({
      where: {
        brand: { userId },
        status: 'active',
      },
      include: { brand: true },
      orderBy: { priority: 'asc' }, // Lower number = higher priority
    });

    const totalCapacity = 100; // Max posts per hour
    let allocatedCapacity = 0;

    const campaignAllocations = activeCampaigns.map((campaign) => {
      const baseAllocation = Math.max(10, Math.floor(totalCapacity / activeCampaigns.length));

      // Give priority campaigns extra allocation
      const priorityBonus = campaign.priority === 1 ? 20 : campaign.priority === 2 ? 10 : 0;
      const finalAllocation = Math.min(
        baseAllocation + priorityBonus,
        totalCapacity - allocatedCapacity
      );

      allocatedCapacity += finalAllocation;

      return {
        campaignId: campaign.id,
        priority: campaign.priority || 999,
        allocatedSlots: finalAllocation,
        estimatedGenerationTime: finalAllocation * 0.5, // 0.5 minutes per post
      };
    });

    return {
      campaigns: campaignAllocations,
      totalCapacity,
      utilizationRate: allocatedCapacity / totalCapacity,
    };
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

  /**
   * Suggest an alternative posting time to avoid conflicts
   */
  private suggestAlternativeTime(originalTime: string): string {
    let [hours, minutes] = originalTime.split(':').map(Number);
    // Fallbacks for invalid input
    if (typeof hours !== 'number' || isNaN(hours)) hours = 12;
    if (typeof minutes !== 'number' || isNaN(minutes)) minutes = 0;
    let newHours = hours;

    // Try 2 hours later, then 2 hours earlier
    if (hours <= 21) {
      newHours = hours + 2;
    } else if (hours >= 3) {
      newHours = hours - 2;
    } else {
      newHours = 12; // Default to noon
    }

    return `${newHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }
}

export const campaignCoordinationService = new CampaignCoordinationService();
