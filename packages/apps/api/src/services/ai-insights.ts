import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();

export type InsightType = 'performance' | 'timing' | 'content' | 'audience' | 'competitive';
export type InsightPriority = 'high' | 'medium' | 'low';

export interface AIInsight {
  id: string;
  type: InsightType;
  priority: InsightPriority;
  title: string;
  description: string;
  impact: string;
  actionable: boolean;
  action?: {
    label: string;
    type: 'schedule' | 'content' | 'hashtag' | 'engagement';
    data?: any;
  };
  supportingData: {
    metric: string;
    value: number | string;
    change?: number;
    trend?: 'up' | 'down' | 'stable';
  }[];
  timestamp: Date;
}

export interface InsightsReport {
  brandId: string;
  generatedAt: Date;
  insights: AIInsight[];
  summary: {
    totalInsights: number;
    highPriority: number;
    mediumPriority: number;
    lowPriority: number;
  };
}

export class AIInsightsService {
  /**
   * Generate AI-powered insights for a brand
   */
  async generateInsights(brandId: string, days: number = 30): Promise<InsightsReport> {
    const insights: AIInsight[] = [];

    // Fetch analytics data
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const publications = await prisma.contentPublication.findMany({
      where: {
        content: { brandId },
        publishedAt: { gte: startDate },
      },
      include: {
        metricsLatest: true,
        content: true,
      },
      orderBy: { publishedAt: 'desc' },
    });

    if (publications.length === 0) {
      return {
        brandId,
        generatedAt: new Date(),
        insights: this.getDefaultInsights(),
        summary: { totalInsights: 3, highPriority: 0, mediumPriority: 1, lowPriority: 2 },
      };
    }

    // 1. Performance Insights
    insights.push(...this.analyzePerformanceTrends(publications));

    // 2. Timing Insights
    insights.push(...this.analyzeOptimalTiming(publications));

    // 3. Content Insights
    insights.push(...this.analyzeContentPatterns(publications));

    // 4. Audience Insights
    insights.push(...this.analyzeAudienceBehavior(publications));

    // 5. Anomaly Detection
    insights.push(...this.detectAnomalies(publications));

    // Sort by priority and timestamp
    insights.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      return b.timestamp.getTime() - a.timestamp.getTime();
    });

    const summary = {
      totalInsights: insights.length,
      highPriority: insights.filter((i) => i.priority === 'high').length,
      mediumPriority: insights.filter((i) => i.priority === 'medium').length,
      lowPriority: insights.filter((i) => i.priority === 'low').length,
    };

    return {
      brandId,
      generatedAt: new Date(),
      insights: insights.slice(0, 10), // Return top 10 insights
      summary,
    };
  }

  /**
   * Analyze performance trends and generate insights
   */
  private analyzePerformanceTrends(publications: any[]): AIInsight[] {
    const insights: AIInsight[] = [];

    // Calculate average engagement rate
    const validPubs = publications.filter((p) => p.metricsLatest);
    if (validPubs.length < 2) return insights;

    // Split into recent vs older posts
    const midpoint = Math.floor(validPubs.length / 2);
    const recentPosts = validPubs.slice(0, midpoint);
    const olderPosts = validPubs.slice(midpoint);

    const recentAvg =
      recentPosts.reduce((sum, p) => sum + Number(p.metricsLatest.engagementRate || 0), 0) /
      recentPosts.length;
    const olderAvg =
      olderPosts.reduce((sum, p) => sum + Number(p.metricsLatest.engagementRate || 0), 0) /
      olderPosts.length;

    const change = ((recentAvg - olderAvg) / olderAvg) * 100;

    if (Math.abs(change) > 10) {
      insights.push({
        id: `perf-trend-${Date.now()}`,
        type: 'performance',
        priority: Math.abs(change) > 20 ? 'high' : 'medium',
        title: change > 0 ? 'Strong Engagement Growth Detected' : 'Engagement Rate Declining',
        description:
          change > 0
            ? `Your recent posts are performing ${Math.abs(change).toFixed(1)}% better than your earlier content. Keep up the momentum!`
            : `Your engagement rate has dropped ${Math.abs(change).toFixed(1)}% recently. Consider refreshing your content strategy.`,
        impact:
          change > 0
            ? `Maintaining this trend could increase your reach by ${(Math.abs(change) * 2).toFixed(0)}% over the next month.`
            : `Reversing this trend is critical to maintain audience growth and reach.`,
        actionable: true,
        action:
          change < 0
            ? {
                label: 'View Content Recommendations',
                type: 'content',
              }
            : undefined,
        supportingData: [
          { metric: 'Recent Avg Engagement Rate', value: `${recentAvg.toFixed(2)}%` },
          { metric: 'Previous Avg Engagement Rate', value: `${olderAvg.toFixed(2)}%` },
          { metric: 'Change', value: change.toFixed(1), change, trend: change > 0 ? 'up' : 'down' },
        ],
        timestamp: new Date(),
      });
    }

    return insights;
  }

  /**
   * Analyze posting times and generate timing insights
   */
  private analyzeOptimalTiming(publications: any[]): AIInsight[] {
    const insights: AIInsight[] = [];
    const validPubs = publications.filter((p) => p.metricsLatest && p.publishedAt);

    if (validPubs.length < 5) return insights;

    // Group by day of week and hour
    const timeSlots: Map<string, { engagement: number; count: number }> = new Map();

    validPubs.forEach((pub) => {
      const date = new Date(pub.publishedAt);
      const day = date.getDay();
      const hour = date.getHours();
      const key = `${day}-${hour}`;
      const engagement = Number(pub.metricsLatest.engagementRate || 0);

      if (!timeSlots.has(key)) {
        timeSlots.set(key, { engagement: 0, count: 0 });
      }
      const slot = timeSlots.get(key)!;
      slot.engagement += engagement;
      slot.count += 1;
    });

    // Find best performing time slot
    let bestSlot: { key: string; avgEngagement: number } | null = null;
    let worstSlot: { key: string; avgEngagement: number } | null = null;

    timeSlots.forEach((data, key) => {
      const avgEngagement = data.engagement / data.count;
      if (!bestSlot || avgEngagement > bestSlot.avgEngagement) {
        bestSlot = { key, avgEngagement };
      }
      if (!worstSlot || avgEngagement < worstSlot.avgEngagement) {
        worstSlot = { key, avgEngagement };
      }
    });

    // Check if we have meaningful timing data
    if (bestSlot !== null && worstSlot !== null) {
      // TypeScript can't narrow types assigned in forEach, so we use type assertions
      const best = bestSlot as { key: string; avgEngagement: number };
      const worst = worstSlot as { key: string; avgEngagement: number };
      const bestAvg = best.avgEngagement;
      const worstAvg = worst.avgEngagement;

      if (bestAvg > worstAvg * 1.5) {
        const [day, hour] = best.key.split('-').map(Number);
        const dayName = [
          'Sunday',
          'Monday',
          'Tuesday',
          'Wednesday',
          'Thursday',
          'Friday',
          'Saturday',
        ][day];
        const timeStr = this.formatHour(hour);

        insights.push({
          id: `timing-optimal-${Date.now()}`,
          type: 'timing',
          priority: 'high',
          title: 'Optimal Posting Time Identified',
          description: `Posts published on ${dayName}s at ${timeStr} get ${((bestAvg / worstAvg - 1) * 100).toFixed(0)}% more engagement than your average.`,
          impact:
            'Scheduling more content during this window could significantly boost your overall engagement.',
          actionable: true,
          action: {
            label: 'Schedule Content for This Time',
            type: 'schedule',
            data: { day, hour },
          },
          supportingData: [
            { metric: 'Best Time', value: `${dayName}, ${timeStr}` },
            { metric: 'Avg Engagement', value: `${bestAvg.toFixed(2)}%` },
            { metric: 'Posts Analyzed', value: validPubs.length },
          ],
          timestamp: new Date(),
        });
      }
    }

    return insights;
  }

  /**
   * Analyze content patterns
   */
  private analyzeContentPatterns(publications: any[]): AIInsight[] {
    const insights: AIInsight[] = [];
    const validPubs = publications.filter((p) => p.metricsLatest);

    if (validPubs.length < 10) return insights;

    // Analyze caption length vs engagement
    const captionData = validPubs
      .filter((p) => p.content.caption)
      .map((p) => ({
        length: (p.content.caption || '').length,
        engagement: Number(p.metricsLatest.engagementRate || 0),
      }));

    if (captionData.length >= 10) {
      // Sort by length and split into quartiles
      captionData.sort((a, b) => a.length - b.length);
      const shortCaptions = captionData.slice(0, Math.floor(captionData.length / 4));
      const longCaptions = captionData.slice(-Math.floor(captionData.length / 4));

      const shortAvg =
        shortCaptions.reduce((sum, d) => sum + d.engagement, 0) / shortCaptions.length;
      const longAvg = longCaptions.reduce((sum, d) => sum + d.engagement, 0) / longCaptions.length;

      if (Math.abs(shortAvg - longAvg) / Math.max(shortAvg, longAvg) > 0.2) {
        const better = shortAvg > longAvg ? 'shorter' : 'longer';
        const betterAvg = shortAvg > longAvg ? shortAvg : longAvg;
        const worseAvg = shortAvg > longAvg ? longAvg : shortAvg;

        insights.push({
          id: `content-caption-${Date.now()}`,
          type: 'content',
          priority: 'medium',
          title: `${better === 'shorter' ? 'Shorter' : 'Longer'} Captions Perform Better`,
          description: `Your ${better} captions (${better === 'shorter' ? 'under 100' : 'over 200'} characters) get ${((betterAvg / worseAvg - 1) * 100).toFixed(0)}% more engagement.`,
          impact: 'Adjusting your caption strategy could improve overall engagement rates.',
          actionable: true,
          action: {
            label: 'View Caption Best Practices',
            type: 'content',
          },
          supportingData: [
            {
              metric: `${better === 'shorter' ? 'Short' : 'Long'} Caption Engagement`,
              value: `${betterAvg.toFixed(2)}%`,
            },
            {
              metric: `${better === 'shorter' ? 'Long' : 'Short'} Caption Engagement`,
              value: `${worseAvg.toFixed(2)}%`,
            },
          ],
          timestamp: new Date(),
        });
      }
    }

    return insights;
  }

  /**
   * Analyze audience behavior
   */
  private analyzeAudienceBehavior(publications: any[]): AIInsight[] {
    const insights: AIInsight[] = [];
    const validPubs = publications.filter((p) => p.metricsLatest);

    if (validPubs.length < 10) return insights;

    // Analyze saves vs likes ratio
    const totalLikes = validPubs.reduce((sum, p) => sum + (p.metricsLatest.likes || 0), 0);
    const totalSaves = validPubs.reduce((sum, p) => sum + (p.metricsLatest.saves || 0), 0);

    if (totalLikes > 0) {
      const saveRate = (totalSaves / totalLikes) * 100;

      if (saveRate > 5) {
        insights.push({
          id: `audience-saves-${Date.now()}`,
          type: 'audience',
          priority: 'medium',
          title: 'High-Value Content Resonating with Audience',
          description: `Your content has a ${saveRate.toFixed(1)}% save rate, indicating your audience finds it valuable enough to revisit.`,
          impact: "High save rates boost your content's reach in Instagram's algorithm.",
          actionable: false,
          supportingData: [
            { metric: 'Total Saves', value: totalSaves },
            { metric: 'Total Likes', value: totalLikes },
            { metric: 'Save Rate', value: `${saveRate.toFixed(1)}%` },
          ],
          timestamp: new Date(),
        });
      }
    }

    return insights;
  }

  /**
   * Detect performance anomalies
   */
  private detectAnomalies(publications: any[]): AIInsight[] {
    const insights: AIInsight[] = [];
    const validPubs = publications.filter((p) => p.metricsLatest);

    if (validPubs.length < 10) return insights;

    // Calculate mean and standard deviation
    const engagementRates = validPubs.map((p) => Number(p.metricsLatest.engagementRate || 0));
    const mean = engagementRates.reduce((sum, val) => sum + val, 0) / engagementRates.length;
    const variance =
      engagementRates.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
      engagementRates.length;
    const stdDev = Math.sqrt(variance);

    // Find posts that are 2+ standard deviations from mean
    const outliers = validPubs.filter((p) => {
      const engagement = Number(p.metricsLatest.engagementRate || 0);
      return Math.abs(engagement - mean) > 2 * stdDev;
    });

    if (outliers.length > 0) {
      const bestOutlier = outliers.reduce((best, p) =>
        Number(p.metricsLatest.engagementRate) > Number(best.metricsLatest.engagementRate)
          ? p
          : best
      );

      insights.push({
        id: `anomaly-viral-${Date.now()}`,
        type: 'performance',
        priority: 'high',
        title: 'Viral Content Detected',
        description: `One of your recent posts is performing exceptionally well—${((Number(bestOutlier.metricsLatest.engagementRate) / mean - 1) * 100).toFixed(0)}% above your average!`,
        impact: 'Analyzing what made this content successful can help replicate its performance.',
        actionable: true,
        action: {
          label: 'Analyze This Post',
          type: 'content',
          data: { postId: bestOutlier.id },
        },
        supportingData: [
          {
            metric: 'Post Engagement Rate',
            value: `${Number(bestOutlier.metricsLatest.engagementRate).toFixed(2)}%`,
          },
          { metric: 'Average Engagement Rate', value: `${mean.toFixed(2)}%` },
          {
            metric: 'Performance vs Average',
            value: `${((Number(bestOutlier.metricsLatest.engagementRate) / mean - 1) * 100).toFixed(0)}%`,
            trend: 'up',
          },
        ],
        timestamp: new Date(),
      });
    }

    return insights;
  }

  /**
   * Default insights for new brands
   */
  private getDefaultInsights(): AIInsight[] {
    return [
      {
        id: 'default-1',
        type: 'timing',
        priority: 'medium',
        title: 'Start Building Your Analytics Foundation',
        description:
          'Publish at least 10 posts to unlock personalized insights about your best-performing content and optimal posting times.',
        impact: 'More data enables more accurate and actionable recommendations.',
        actionable: true,
        action: {
          label: 'Create Content',
          type: 'content',
        },
        supportingData: [],
        timestamp: new Date(),
      },
      {
        id: 'default-2',
        type: 'performance',
        priority: 'low',
        title: 'Consistency is Key',
        description:
          'Maintain a regular posting schedule to build audience engagement and improve reach.',
        impact: 'Consistent posting trains your audience to expect and engage with your content.',
        actionable: false,
        supportingData: [],
        timestamp: new Date(),
      },
      {
        id: 'default-3',
        type: 'content',
        priority: 'low',
        title: 'Experiment with Content Types',
        description:
          'Try different content formats (photos, carousels, reels) to see what resonates with your audience.',
        impact: 'Diversifying content types helps you discover what your audience prefers.',
        actionable: false,
        supportingData: [],
        timestamp: new Date(),
      },
    ];
  }

  /**
   * Format hour for display
   */
  private formatHour(hour: number): string {
    if (hour === 0) return '12:00 AM';
    if (hour === 12) return '12:00 PM';
    if (hour < 12) return `${hour}:00 AM`;
    return `${hour - 12}:00 PM`;
  }
}

export const aiInsightsService = new AIInsightsService();
