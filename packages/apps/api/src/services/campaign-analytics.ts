import { PrismaClient } from '@postolio/database';

const prisma = new PrismaClient();

export interface CampaignMetrics {
  totalPosts: number;
  totalImpressions: number;
  totalEngagement: number;
  averageEngagementRate: number;
  reach: number;
  postsScheduled: number;
  postsPosted: number;
  postsDraft: number;
  campaignDuration: number;
  postingFrequency: number;
  topHashtags: Array<{ tag: string; count: number; avgEngagement: number }>;
  performanceByDate: Array<{
    date: string;
    impressions: number;
    engagement: number;
  }>;
}

export interface CampaignComparison {
  campaigns: Array<{
    id: string;
    name: string;
    metrics: CampaignMetrics;
    performance: 'high' | 'medium' | 'low';
  }>;
  summary: {
    totalCampaigns: number;
    avgEngagementRate: number;
    bestPerformingMetric: string;
    improvementOpportunity: string;
  };
  topPerformer: string;
}

export interface OptimizationRecommendation {
  type: 'frequency' | 'content' | 'timing' | 'hashtags' | 'themes';
  message: string;
  priority: 'high' | 'medium' | 'low';
  impact: string;
  actionable: boolean;
  data?: Record<string, unknown>;
}

export interface ROIMetrics {
  estimatedValue: number;
  engagementValue: number;
  reachValue: number;
  breakdown: {
    costPerEngagement: number;
    estimatedReach: number;
    valuePerImpression: number;
  };
  methodology: string;
}

export class CampaignAnalyticsService {
  /**
   * Get comprehensive metrics for a single campaign
   */
  async getCampaignMetrics(campaignId: string, userId: string): Promise<CampaignMetrics> {
    // Verify campaign ownership
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: campaignId,
        brand: { userId },
      },
      include: {
        content: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!campaign) {
      throw new Error('Campaign not found or access denied');
    }

    const content = campaign.content;
    const configRaw = campaign.config as unknown;
    const config =
      configRaw && typeof configRaw === 'object' ? (configRaw as Record<string, unknown>) : null;

    // Calculate basic metrics
    const totalPosts = content.length;
    const postsPosted = content.filter((c) => c.status === 'published').length;
    const postsScheduled = content.filter((c) => c.status === 'scheduled').length;
    const postsDraft = content.filter((c) => c.status === 'draft').length;

    // Extract performance metrics from generationParams
    let totalImpressions = 0;
    let totalEngagement = 0;
    let totalReach = 0;

    const performanceByDate: Array<{
      date: string;
      impressions: number;
      engagement: number;
    }> = [];
    const hashtagCounts: Record<string, { count: number; totalEngagement: number }> = {};

    content.forEach((post) => {
      const params = post.generationParams as Record<string, unknown> | null;
      if (params) {
        const impressions = typeof params.impressions === 'number' ? params.impressions : 0;
        const engagement = typeof params.engagement === 'number' ? params.engagement : 0;
        const reach = typeof params.reach === 'number' ? params.reach : 0;

        totalImpressions += impressions;
        totalEngagement += engagement;
        totalReach += reach;

        // Track performance by date
        if (post.postedAt) {
          const iso = post.postedAt.toISOString();
          const date: string = (iso && iso.split('T')[0]) || 'unknown-date';
          performanceByDate.push({ date, impressions, engagement });
        }

        // Track hashtag performance
        post.hashtags.forEach((tag) => {
          if (!hashtagCounts[tag]) {
            hashtagCounts[tag] = { count: 0, totalEngagement: 0 };
          }
          hashtagCounts[tag].count++;
          hashtagCounts[tag].totalEngagement += engagement;
        });
      }
    });

    // Calculate derived metrics
    const averageEngagementRate =
      totalImpressions > 0 ? (totalEngagement / totalImpressions) * 100 : 0;

    // Campaign duration and frequency
    const duration =
      config && typeof config.duration === 'object'
        ? (config.duration as Record<string, unknown>)
        : undefined;
    const startDate =
      duration && typeof duration.start === 'string'
        ? new Date(duration.start)
        : campaign.createdAt;
    const endDate =
      duration && typeof duration.end === 'string' ? new Date(duration.end) : new Date();
    const campaignDuration = Math.ceil(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    const postingFrequency = campaignDuration > 0 ? totalPosts / campaignDuration : 0;

    // Top hashtags
    const topHashtags = Object.entries(hashtagCounts)
      .map(([tag, data]) => ({
        tag,
        count: data.count,
        avgEngagement: data.count > 0 ? data.totalEngagement / data.count : 0,
      }))
      .sort((a, b) => b.avgEngagement - a.avgEngagement)
      .slice(0, 10);

    return {
      totalPosts,
      totalImpressions,
      totalEngagement,
      averageEngagementRate,
      reach: totalReach,
      postsScheduled,
      postsPosted,
      postsDraft,
      campaignDuration,
      postingFrequency,
      topHashtags,
      performanceByDate,
    };
  }

  /**
   * Compare performance across multiple campaigns
   */
  async compareCampaigns(campaignIds: string[], userId: string): Promise<CampaignComparison> {
    const campaigns = [];
    let totalEngagement = 0;
    let totalImpressions = 0;
    let bestPerformer = '';
    let bestPerformance = 0;

    for (const campaignId of campaignIds) {
      const campaign = await prisma.campaign.findFirst({
        where: {
          id: campaignId,
          brand: { userId },
        },
      });

      if (campaign) {
        const metrics = await this.getCampaignMetrics(campaignId, userId);
        const performance = this.classifyPerformance(metrics.averageEngagementRate);

        campaigns.push({
          id: campaignId,
          name: campaign.name,
          metrics,
          performance,
        });

        totalEngagement += metrics.totalEngagement;
        totalImpressions += metrics.totalImpressions;

        if (metrics.averageEngagementRate > bestPerformance) {
          bestPerformance = metrics.averageEngagementRate;
          bestPerformer = campaign.name;
        }
      }
    }

    const avgEngagementRate = totalImpressions > 0 ? (totalEngagement / totalImpressions) * 100 : 0;

    // Analyze performance patterns
    const engagementRates = campaigns.map((c) => c.metrics.averageEngagementRate);
    const avgRate = engagementRates.reduce((sum, rate) => sum + rate, 0) / engagementRates.length;

    let bestPerformingMetric = 'engagement';
    let improvementOpportunity = 'frequency';

    // Determine best performing metric and improvement opportunity
    const totalReach = campaigns.reduce((sum, c) => sum + c.metrics.reach, 0);
    const totalPosts = campaigns.reduce((sum, c) => sum + c.metrics.totalPosts, 0);

    if (totalReach > totalImpressions * 0.8) {
      bestPerformingMetric = 'reach';
    } else if (totalPosts / campaigns.length > 20) {
      bestPerformingMetric = 'consistency';
    }

    if (avgRate < 2) {
      improvementOpportunity = 'content quality';
    } else if (campaigns.some((c) => c.metrics.postingFrequency < 0.5)) {
      improvementOpportunity = 'posting frequency';
    }

    return {
      campaigns,
      summary: {
        totalCampaigns: campaigns.length,
        avgEngagementRate,
        bestPerformingMetric,
        improvementOpportunity,
      },
      topPerformer: bestPerformer,
    };
  }

  /**
   * Generate optimization recommendations for a campaign
   */
  async getOptimizationRecommendations(
    campaignId: string,
    userId: string
  ): Promise<OptimizationRecommendation[]> {
    const metrics = await this.getCampaignMetrics(campaignId, userId);
    const recommendations: OptimizationRecommendation[] = [];

    // Engagement rate recommendations
    if (metrics.averageEngagementRate < 1) {
      recommendations.push({
        type: 'content',
        message: 'Low engagement rate detected. Consider improving content quality and relevance.',
        priority: 'high',
        impact: 'Could increase engagement by 50-100%',
        actionable: true,
        data: { currentRate: metrics.averageEngagementRate, targetRate: 2.5 },
      });
    }

    // Posting frequency recommendations
    if (metrics.postingFrequency < 0.3) {
      recommendations.push({
        type: 'frequency',
        message:
          'Low posting frequency may reduce audience engagement. Consider increasing posting cadence.',
        priority: 'medium',
        impact: 'Consistent posting can improve visibility by 30%',
        actionable: true,
        data: {
          currentFrequency: metrics.postingFrequency,
          recommendedFrequency: 0.5,
        },
      });
    }

    // Hashtag optimization
    if (metrics.topHashtags.length > 0) {
      const avgHashtagEngagement =
        metrics.topHashtags.reduce((sum, h) => sum + h.avgEngagement, 0) /
        metrics.topHashtags.length;
      if (avgHashtagEngagement < (metrics.totalEngagement / metrics.totalPosts) * 0.8) {
        recommendations.push({
          type: 'hashtags',
          message:
            'Hashtag performance is below campaign average. Research trending hashtags in your niche.',
          priority: 'medium',
          impact: 'Better hashtags can increase discoverability by 25%',
          actionable: true,
          data: { topPerformingTags: metrics.topHashtags.slice(0, 3) },
        });
      }
    }

    // Content timing recommendations
    const recentPosts = metrics.performanceByDate.slice(-7);
    if (recentPosts.length >= 3) {
      const recentAvgEngagement =
        recentPosts.reduce((sum, p) => sum + p.engagement, 0) / recentPosts.length;
      const overallAvgEngagement = metrics.totalEngagement / metrics.totalPosts;

      if (recentAvgEngagement < overallAvgEngagement * 0.8) {
        recommendations.push({
          type: 'timing',
          message:
            'Recent posts show declining engagement. Consider analyzing optimal posting times.',
          priority: 'medium',
          impact: 'Optimal timing can improve engagement by 20%',
          actionable: true,
          data: { recentTrend: 'declining', analysisNeeded: true },
        });
      }
    }

    // Success pattern recommendations
    if (metrics.averageEngagementRate > 3) {
      recommendations.push({
        type: 'content',
        message: 'Excellent engagement rate! Consider scaling successful content themes.',
        priority: 'low',
        impact: 'Maintaining quality while scaling',
        actionable: true,
        data: {
          currentRate: metrics.averageEngagementRate,
          status: 'excellent',
        },
      });
    }

    return recommendations.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }

  /**
   * Calculate ROI metrics for a campaign
   */
  async calculateROI(campaignId: string, userId: string): Promise<ROIMetrics> {
    const metrics = await this.getCampaignMetrics(campaignId, userId);

    // Industry standard values (adjustable based on niche)
    const COST_PER_ENGAGEMENT = 0.05; // $0.05 per engagement (typical social media value)
    const VALUE_PER_IMPRESSION = 0.001; // $0.001 per impression (CPM-based value)
    const REACH_MULTIPLIER = 1.5; // Reach is typically 1.5x more valuable than impressions

    // Calculate estimated value
    const engagementValue = metrics.totalEngagement * COST_PER_ENGAGEMENT;
    const impressionValue = metrics.totalImpressions * VALUE_PER_IMPRESSION;
    const reachValue = metrics.reach * VALUE_PER_IMPRESSION * REACH_MULTIPLIER;

    const estimatedValue = engagementValue + impressionValue + reachValue;

    return {
      estimatedValue: Math.round(estimatedValue * 100) / 100,
      engagementValue: Math.round(engagementValue * 100) / 100,
      reachValue: Math.round(reachValue * 100) / 100,
      breakdown: {
        costPerEngagement: COST_PER_ENGAGEMENT,
        estimatedReach: metrics.reach,
        valuePerImpression: VALUE_PER_IMPRESSION,
      },
      methodology:
        'Based on industry standard CPM and engagement values. Actual ROI may vary by industry and audience quality.',
    };
  }

  /**
   * Classify campaign performance
   */
  private classifyPerformance(engagementRate: number): 'high' | 'medium' | 'low' {
    if (engagementRate >= 3) return 'high';
    if (engagementRate >= 1.5) return 'medium';
    return 'low';
  }
}

export const campaignAnalyticsService = new CampaignAnalyticsService();
