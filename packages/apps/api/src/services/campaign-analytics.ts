import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();

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
  // Week 3 enhancements
  postsTimeline: Array<{
    contentId: string;
    publishedAt: string | null;
    engagement: number;
    reach: number;
    impressions: number;
    engagementRate: number;
    caption?: string;
  }>;
  contentTypeBreakdown: Record<
    string,
    {
      count: number;
      totalEngagement: number;
      avgEngagementRate: number;
    }
  >;
  performanceVsGoal?: {
    goalType: string;
    goalValue: number;
    currentValue: number;
    progress: number;
    onTrack: boolean;
  };
  platformBreakdown: Record<
    string,
    {
      posts: number;
      impressions: number;
      engagement: number;
      reach: number;
    }
  >;
  topPerformingPost?: {
    contentId: string;
    publishedAt: string | null;
    engagement: number;
    engagementRate: number;
    caption?: string;
  };
  worstPerformingPost?: {
    contentId: string;
    publishedAt: string | null;
    engagement: number;
    engagementRate: number;
    caption?: string;
  };
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
          include: {
            publications: {
              include: {
                metricsLatest: true,
              },
            },
            mediaAssets: true,
          },
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

    // Extract performance metrics from analytics v2 (publications + metricsLatest)
    let totalImpressions = 0;
    let totalEngagement = 0;
    let totalReach = 0;

    const performanceByDate: Array<{
      date: string;
      impressions: number;
      engagement: number;
    }> = [];
    const hashtagCounts: Record<string, { count: number; totalEngagement: number }> = {};

    // Week 3: Enhanced tracking
    const postsTimeline: Array<{
      contentId: string;
      publishedAt: string | null;
      engagement: number;
      reach: number;
      impressions: number;
      engagementRate: number;
      caption?: string;
    }> = [];

    const contentTypeBreakdown: Record<
      string,
      {
        count: number;
        totalEngagement: number;
        avgEngagementRate: number;
        totalImpressions: number;
      }
    > = {};

    const platformBreakdown: Record<
      string,
      {
        posts: number;
        impressions: number;
        engagement: number;
        reach: number;
      }
    > = {};

    let topPost: {
      contentId: string;
      engagement: number;
      engagementRate: number;
      publishedAt: string | null;
      caption?: string;
    } | null = null;

    let worstPost: {
      contentId: string;
      engagement: number;
      engagementRate: number;
      publishedAt: string | null;
      caption?: string;
    } | null = null;

    content.forEach((post) => {
      // Get metrics from publications (analytics v2)
      let impressions = 0;
      let engagement = 0;
      let reach = 0;
      let platform = 'unknown';

      if (post.publications && post.publications.length > 0) {
        // Use latest publication metrics
        const pub = post.publications[0];
        const metrics = pub.metricsLatest;
        if (metrics) {
          impressions = Number(metrics.impressions || 0);
          engagement =
            Number(metrics.likes || 0) +
            Number(metrics.comments || 0) +
            Number(metrics.saves || 0) +
            Number(metrics.shares || 0);
          reach = Number(metrics.reach || 0);
          platform = pub.platform;
        }
      } else {
        // Fallback to generationParams (legacy)
        const params = post.generationParams as Record<string, unknown> | null;
        if (params) {
          impressions = typeof params.impressions === 'number' ? params.impressions : 0;
          engagement = typeof params.engagement === 'number' ? params.engagement : 0;
          reach = typeof params.reach === 'number' ? params.reach : 0;
        }
      }

      totalImpressions += impressions;
      totalEngagement += engagement;
      totalReach += reach;

      const engagementRate = impressions > 0 ? (engagement / impressions) * 100 : 0;

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

      // Week 3: Posts timeline
      if (post.status === 'published') {
        postsTimeline.push({
          contentId: post.id,
          publishedAt: post.postedAt?.toISOString() || null,
          engagement,
          reach,
          impressions,
          engagementRate,
          caption: post.caption.substring(0, 100),
        });

        // Track top/worst performing posts
        if (!topPost || engagement > topPost.engagement) {
          topPost = {
            contentId: post.id,
            engagement,
            engagementRate,
            publishedAt: post.postedAt?.toISOString() || null,
            caption: post.caption.substring(0, 100),
          };
        }

        if (!worstPost || engagement < worstPost.engagement) {
          worstPost = {
            contentId: post.id,
            engagement,
            engagementRate,
            publishedAt: post.postedAt?.toISOString() || null,
            caption: post.caption.substring(0, 100),
          };
        }
      }

      // Week 3: Content type breakdown
      // ContentAsset doesn't have assetType, default to 'image' if media exists
      const contentType = post.mediaAssets?.length > 0 ? 'image' : 'text';
      if (!contentTypeBreakdown[contentType]) {
        contentTypeBreakdown[contentType] = {
          count: 0,
          totalEngagement: 0,
          avgEngagementRate: 0,
          totalImpressions: 0,
        };
      }
      contentTypeBreakdown[contentType].count++;
      contentTypeBreakdown[contentType].totalEngagement += engagement;
      contentTypeBreakdown[contentType].totalImpressions += impressions;

      // Week 3: Platform breakdown
      if (!platformBreakdown[platform]) {
        platformBreakdown[platform] = {
          posts: 0,
          impressions: 0,
          engagement: 0,
          reach: 0,
        };
      }
      platformBreakdown[platform].posts++;
      platformBreakdown[platform].impressions += impressions;
      platformBreakdown[platform].engagement += engagement;
      platformBreakdown[platform].reach += reach;
    });

    // Calculate average engagement rates for content types
    Object.keys(contentTypeBreakdown).forEach((type) => {
      const breakdown = contentTypeBreakdown[type];
      breakdown.avgEngagementRate =
        breakdown.totalImpressions > 0
          ? (breakdown.totalEngagement / breakdown.totalImpressions) * 100
          : 0;
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

    // Week 3: Performance vs Goal calculation
    let performanceVsGoal: CampaignMetrics['performanceVsGoal'] = undefined;
    if (config && config.goal) {
      const goal = config.goal as Record<string, unknown>;
      const goalType = (goal.type as string) || 'engagement';
      const goalValue = (goal.value as number) || 0;

      let currentValue = 0;
      switch (goalType) {
        case 'engagement':
          currentValue = totalEngagement;
          break;
        case 'impressions':
          currentValue = totalImpressions;
          break;
        case 'reach':
          currentValue = totalReach;
          break;
        case 'posts':
          currentValue = postsPosted;
          break;
        default:
          currentValue = totalEngagement;
      }

      performanceVsGoal = {
        goalType,
        goalValue,
        currentValue,
        progress: goalValue > 0 ? (currentValue / goalValue) * 100 : 0,
        onTrack: currentValue >= goalValue * 0.8, // 80% threshold
      };
    }

    // Build top and worst performing post objects
    let topPerformingPost:
      | {
          contentId: string;
          publishedAt: string | null;
          engagement: number;
          engagementRate: number;
          caption?: string;
        }
      | undefined;

    let worstPerformingPost:
      | {
          contentId: string;
          publishedAt: string | null;
          engagement: number;
          engagementRate: number;
          caption?: string;
        }
      | undefined;

    if (topPost !== null) {
      // TypeScript can't narrow types assigned in forEach, so we use type assertion
      const top = topPost as {
        contentId: string;
        engagement: number;
        engagementRate: number;
        publishedAt: string | null;
        caption?: string;
      };
      topPerformingPost = {
        contentId: top.contentId,
        publishedAt: top.publishedAt,
        engagement: top.engagement,
        engagementRate: top.engagementRate,
        caption: top.caption,
      };
    }

    if (worstPost !== null) {
      // TypeScript can't narrow types assigned in forEach, so we use type assertion
      const worst = worstPost as {
        contentId: string;
        engagement: number;
        engagementRate: number;
        publishedAt: string | null;
        caption?: string;
      };
      worstPerformingPost = {
        contentId: worst.contentId,
        publishedAt: worst.publishedAt,
        engagement: worst.engagement,
        engagementRate: worst.engagementRate,
        caption: worst.caption,
      };
    }

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
      // Week 3 enhancements
      postsTimeline: postsTimeline.sort((a, b) => {
        if (!a.publishedAt) return 1;
        if (!b.publishedAt) return -1;
        return new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime();
      }),
      contentTypeBreakdown,
      performanceVsGoal,
      platformBreakdown,
      topPerformingPost,
      worstPerformingPost,
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
   * Compare multiple campaigns (up to 3)
   */
  async compareCampaigns(
    campaignIds: string[],
    userId: string
  ): Promise<{
    campaigns: Array<{
      id: string;
      name: string;
      metrics: CampaignMetrics;
      relativePerformance: {
        impressions: number; // % difference from average
        engagement: number;
        engagementRate: number;
        postsCount: number;
      };
    }>;
    summary: {
      avgImpressions: number;
      avgEngagement: number;
      avgEngagementRate: number;
      avgPostsCount: number;
    };
  }> {
    if (campaignIds.length === 0 || campaignIds.length > 3) {
      throw new Error('Please provide 1-3 campaign IDs for comparison');
    }

    // Fetch all campaigns with metrics
    const campaignsWithMetrics = await Promise.all(
      campaignIds.map(async (id) => {
        const campaign = await prisma.campaign.findFirst({
          where: {
            id,
            brand: { userId },
          },
          select: { id: true, name: true },
        });

        if (!campaign) {
          throw new Error(`Campaign ${id} not found or access denied`);
        }

        const metrics = await this.getCampaignMetrics(id, userId);
        return {
          id: campaign.id,
          name: campaign.name,
          metrics,
        };
      })
    );

    // Calculate averages
    const summary = {
      avgImpressions:
        campaignsWithMetrics.reduce((sum, c) => sum + c.metrics.totalImpressions, 0) /
        campaignsWithMetrics.length,
      avgEngagement:
        campaignsWithMetrics.reduce((sum, c) => sum + c.metrics.totalEngagement, 0) /
        campaignsWithMetrics.length,
      avgEngagementRate:
        campaignsWithMetrics.reduce((sum, c) => sum + c.metrics.averageEngagementRate, 0) /
        campaignsWithMetrics.length,
      avgPostsCount:
        campaignsWithMetrics.reduce((sum, c) => sum + c.metrics.postsPosted, 0) /
        campaignsWithMetrics.length,
    };

    // Calculate relative performance (% difference from average)
    const campaigns = campaignsWithMetrics.map((c) => ({
      id: c.id,
      name: c.name,
      metrics: c.metrics,
      relativePerformance: {
        impressions:
          summary.avgImpressions > 0
            ? ((c.metrics.totalImpressions - summary.avgImpressions) / summary.avgImpressions) * 100
            : 0,
        engagement:
          summary.avgEngagement > 0
            ? ((c.metrics.totalEngagement - summary.avgEngagement) / summary.avgEngagement) * 100
            : 0,
        engagementRate:
          summary.avgEngagementRate > 0
            ? ((c.metrics.averageEngagementRate - summary.avgEngagementRate) /
                summary.avgEngagementRate) *
              100
            : 0,
        postsCount:
          summary.avgPostsCount > 0
            ? ((c.metrics.postsPosted - summary.avgPostsCount) / summary.avgPostsCount) * 100
            : 0,
      },
    }));

    return {
      campaigns,
      summary,
    };
  }
}

export const campaignAnalyticsService = new CampaignAnalyticsService();
