import { PrismaClient, Prisma } from "@postolio/database";
import { instagramService } from "./instagram.js";

const prisma = new PrismaClient();

export interface PostMetrics {
  postId: string;
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  engagementRate: number;
  timestamp: Date;
  dayOfWeek: number;
  hourOfDay: number;
}

export interface OptimalTimeSlot {
  dayOfWeek: number; // 0=Sunday, 1=Monday, etc.
  hour: number; // 0-23
  engagementScore: number;
  sampleSize: number;
}

export interface AnalyticsReport {
  totalPosts: number;
  totalImpressions: number;
  totalReach: number;
  totalEngagements: number;
  averageEngagementRate: number;
  optimalTimes: OptimalTimeSlot[];
  topPerformingPosts: PostMetrics[];
  engagementTrends: {
    date: string;
    engagementRate: number;
  }[];
}

export interface SchedulingRecommendation {
  recommendedTime: Date;
  confidence: number;
  reason: string;
  alternativeTimes: Date[];
}

// Shape of insights returned from instagramService (partial, only used fields)
interface InsightMetrics {
  impressions?: number;
  reach?: number;
  likes?: number;
  like_count?: number;
  comments?: number;
  comments_count?: number;
  saves?: number;
  saved?: number;
  shares?: number;
}

// Stored analytics JSON subset we rely on
interface StoredAnalytics {
  impressions?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  saves?: number;
  shares?: number;
  engagementRate?: number;
  lastUpdated?: string | Date;
}

function isStoredAnalytics(value: unknown): value is StoredAnalytics {
  if (!value || typeof value !== "object") return false;
  return true; // Relaxed guard; specific property access is defensive
}

class AnalyticsService {
  /**
   * Collect and store metrics for a posted content
   */
  async collectPostMetrics(contentId: string): Promise<PostMetrics | null> {
    try {
      const content = await prisma.content.findFirst({
        where: {
          id: contentId,
          status: "published",
          instagramPostId: { not: null },
        },
        include: {
          brand: true,
        },
      });

      if (!content || !content.instagramPostId) {
        return null;
      }

      // Get insights from Instagram
      if (!instagramService.isConfigured(content.brand)) {
        return null;
      }

      const mediaInsightsRaw = (await instagramService.getMediaInsights(
        content.brand,
        content.instagramPostId,
      )) as unknown;
      const insights = Array.isArray(mediaInsightsRaw)
        ? mediaInsightsRaw.reduce<InsightMetrics>((acc, metric) => {
            const m = metric as {
              name?: string;
              values?: Array<{ value?: number }>;
            };
            const name = m.name;
            const firstVal = m.values?.[0]?.value;
            if (typeof name === "string" && typeof firstVal === "number") {
              switch (name) {
                case "impressions":
                  acc.impressions = firstVal;
                  break;
                case "reach":
                  acc.reach = firstVal;
                  break;
                case "likes":
                  acc.likes = firstVal;
                  break;
                case "comments":
                  acc.comments = firstVal;
                  break;
                case "saves":
                  acc.saves = firstVal;
                  break;
                case "shares":
                  acc.shares = firstVal;
                  break;
              }
            }
            return acc;
          }, {})
        : {};
      const postedAt = content.postedAt || content.createdAt;

      const metrics: PostMetrics = {
        postId: content.instagramPostId,
        impressions: insights.impressions || 0,
        reach: insights.reach || 0,
        likes: insights.likes || insights.like_count || 0,
        comments: insights.comments || insights.comments_count || 0,
        saves: insights.saves || insights.saved || 0,
        shares: insights.shares || 0,
        engagementRate: this.calculateEngagementRate(insights),
        timestamp: postedAt,
        dayOfWeek: postedAt.getDay(),
        hourOfDay: postedAt.getHours(),
      };

      // Store metrics in database
      await this.storeMetrics(contentId, metrics);

      return metrics;
    } catch (error) {
      console.error("Failed to collect post metrics:", error);
      return null;
    }
  }

  /**
   * Calculate engagement rate from insights
   */
  private calculateEngagementRate(insights: InsightMetrics): number {
    const totalEngagements =
      (insights.likes || insights.like_count || 0) +
      (insights.comments || insights.comments_count || 0) +
      (insights.saves || insights.saved || 0) +
      (insights.shares || 0);
    const reach = insights.reach || insights.impressions || 1;
    return (totalEngagements / reach) * 100;
  }

  /**
   * Store metrics in database
   */
  private async storeMetrics(
    contentId: string,
    metrics: PostMetrics,
  ): Promise<void> {
    try {
      // Update content with metrics
      await prisma.content.update({
        where: { id: contentId },
        data: {
          analytics: {
            ...metrics,
            lastUpdated: new Date(),
          },
        },
      });
    } catch (error) {
      console.error("Failed to store metrics:", error);
    }
  }

  /**
   * Analyze optimal posting times for a brand
   */
  async analyzeOptimalTimes(brandId: string): Promise<OptimalTimeSlot[]> {
    try {
      const contents = await prisma.content.findMany({
        where: {
          brandId: brandId,
          status: "published",
          analytics: { not: Prisma.JsonNull },
        },
        orderBy: {
          postedAt: "desc",
        },
        take: 100, // Analyze last 100 posts
      });

      if (contents.length < 5) {
        // Not enough data, return general best practices
        return this.getDefaultOptimalTimes();
      }

      // Group by day of week and hour
      const timeSlotMap = new Map<string, { total: number; count: number }>();

      for (const content of contents) {
        const analyticsRaw = content.analytics;
        if (
          !isStoredAnalytics(analyticsRaw) ||
          typeof analyticsRaw.engagementRate !== "number"
        )
          continue;
        const base: StoredAnalytics = isStoredAnalytics(analyticsRaw)
          ? analyticsRaw
          : {};
        const analytics: StoredAnalytics & { engagementRate: number } = {
          impressions: base.impressions,
          reach: base.reach,
          likes: base.likes,
          comments: base.comments,
          saves: base.saves,
          shares: base.shares,
          engagementRate: base.engagementRate ?? 0,
          lastUpdated: base.lastUpdated,
        };

        const postedAt = content.postedAt || content.createdAt;
        const dayOfWeek = postedAt.getDay();
        const hourOfDay = postedAt.getHours();
        const key = `${dayOfWeek}-${hourOfDay}`;

        const existing = timeSlotMap.get(key) || { total: 0, count: 0 };
        timeSlotMap.set(key, {
          total: existing.total + analytics.engagementRate,
          count: existing.count + 1,
        });
      }

      // Calculate average engagement for each time slot
      const optimalTimes: OptimalTimeSlot[] = [];

      for (const [key, data] of timeSlotMap) {
        if (data.count < 2) continue; // Need at least 2 posts for reliability

        const keyParts = key.split("-");
        if (keyParts.length !== 2 || !keyParts[0] || !keyParts[1]) continue; // Skip malformed keys

        const dayOfWeek = parseInt(keyParts[0], 10);
        const hour = parseInt(keyParts[1], 10);

        if (isNaN(dayOfWeek) || isNaN(hour)) continue; // Skip invalid entries

        optimalTimes.push({
          dayOfWeek,
          hour,
          engagementScore: data.total / data.count,
          sampleSize: data.count,
        });
      }

      // Sort by engagement score and return top 10
      return optimalTimes
        .sort((a, b) => b.engagementScore - a.engagementScore)
        .slice(0, 10);
    } catch (error) {
      console.error("Failed to analyze optimal times:", error);
      return this.getDefaultOptimalTimes();
    }
  }

  /**
   * Get default optimal times based on general best practices
   */
  private getDefaultOptimalTimes(): OptimalTimeSlot[] {
    return [
      { dayOfWeek: 2, hour: 11, engagementScore: 8.5, sampleSize: 0 }, // Tuesday 11 AM
      { dayOfWeek: 3, hour: 14, engagementScore: 8.2, sampleSize: 0 }, // Wednesday 2 PM
      { dayOfWeek: 4, hour: 10, engagementScore: 8.0, sampleSize: 0 }, // Thursday 10 AM
      { dayOfWeek: 1, hour: 13, engagementScore: 7.8, sampleSize: 0 }, // Monday 1 PM
      { dayOfWeek: 5, hour: 15, engagementScore: 7.5, sampleSize: 0 }, // Friday 3 PM
      { dayOfWeek: 0, hour: 12, engagementScore: 7.2, sampleSize: 0 }, // Sunday 12 PM
      { dayOfWeek: 6, hour: 10, engagementScore: 6.8, sampleSize: 0 }, // Saturday 10 AM
    ];
  }

  /**
   * Generate scheduling recommendation for new content
   */
  async getSchedulingRecommendation(
    brandId: string,
  ): Promise<SchedulingRecommendation> {
    try {
      const optimalTimes = await this.analyzeOptimalTimes(brandId);
      const now = new Date();
      // current day/hour retained for future advanced logic (keep underscore to avoid lint unused)

      // Find next optimal time
      const nextRecommendations: Date[] = [];
      if (optimalTimes.length > 0) {
        for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
          // Look ahead 2 weeks
          for (const timeSlot of optimalTimes) {
            const targetDate = new Date(now);
            targetDate.setDate(now.getDate() + dayOffset);
            // Adjust to target day of week
            const dayDiff = (timeSlot.dayOfWeek - targetDate.getDay() + 7) % 7;
            targetDate.setDate(targetDate.getDate() + dayDiff);
            targetDate.setHours(timeSlot.hour, 0, 0, 0);
            // Only suggest future times
            if (targetDate > now) {
              nextRecommendations.push(targetDate);
            }
          }
        }
      }

      // Sort by date and take the best options
      nextRecommendations.sort((a, b) => a.getTime() - b.getTime());

      const primaryRecommendation =
        nextRecommendations[0] || new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const alternativeTimes = nextRecommendations.slice(1, 4);

      // Determine confidence based on sample size
      const topTimeSlot = optimalTimes[0];
      let confidence = 60;
      let reason = "Based on optimal engagement patterns for your brand";
      if (topTimeSlot) {
        confidence = Math.min(95, Math.max(60, topTimeSlot.sampleSize * 10));
        if (topTimeSlot.sampleSize === 0) {
          reason =
            "Based on general Instagram best practices (not enough brand data yet)";
        } else if (topTimeSlot.sampleSize < 5) {
          reason = "Based on limited brand data and general best practices";
        }
      }

      return {
        recommendedTime: primaryRecommendation,
        confidence,
        reason,
        alternativeTimes,
      };
    } catch (error) {
      console.error("Failed to generate scheduling recommendation:", error);

      // Fallback recommendation
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(11, 0, 0, 0);

      return {
        recommendedTime: tomorrow,
        confidence: 60,
        reason: "Default recommendation due to analysis error",
        alternativeTimes: [],
      };
    }
  }

  /**
   * Generate comprehensive analytics report for a brand
   */
  async generateAnalyticsReport(
    brandId: string,
    daysPeriod: number = 30,
  ): Promise<AnalyticsReport> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysPeriod);

      const contents = await prisma.content.findMany({
        where: {
          brandId: brandId,
          status: "published",
          postedAt: { gte: cutoffDate },
          analytics: { not: Prisma.JsonNull },
        },
        orderBy: {
          postedAt: "desc",
        },
      });

      if (contents.length === 0) {
        return this.getEmptyReport();
      }

      let totalImpressions = 0;
      let totalReach = 0;
      let totalEngagements = 0;
      const postMetrics: PostMetrics[] = [];
      const dailyEngagement: {
        [key: string]: { total: number; count: number };
      } = {};

      for (const content of contents) {
        const analyticsRaw = content.analytics;
        if (!isStoredAnalytics(analyticsRaw)) continue;
        const analytics = analyticsRaw;

        totalImpressions += analytics.impressions || 0;
        totalReach += analytics.reach || 0;
        totalEngagements +=
          (analytics.likes || 0) +
          (analytics.comments || 0) +
          (analytics.saves || 0) +
          (analytics.shares || 0);

        const postedAt = content.postedAt || content.createdAt;
        if (!postedAt) continue; // skip if no date
        const dateKey = postedAt.toISOString().split("T")[0];

        const daily = dailyEngagement[dateKey as string] || {
          total: 0,
          count: 0,
        };
        dailyEngagement[dateKey as string] = {
          total: daily.total + (analytics.engagementRate || 0),
          count: daily.count + 1,
        };

        postMetrics.push({
          postId: content.instagramPostId || content.id,
          impressions: analytics.impressions || 0,
          reach: analytics.reach || 0,
          likes: analytics.likes || 0,
          comments: analytics.comments || 0,
          saves: analytics.saves || 0,
          shares: analytics.shares || 0,
          engagementRate: analytics.engagementRate || 0,
          timestamp: postedAt,
          dayOfWeek: postedAt.getDay(),
          hourOfDay: postedAt.getHours(),
        });
      }

      const averageEngagementRate =
        totalReach > 0 ? (totalEngagements / totalReach) * 100 : 0;
      const optimalTimes = await this.analyzeOptimalTimes(brandId);
      const topPerformingPosts = postMetrics
        .sort((a, b) => b.engagementRate - a.engagementRate)
        .slice(0, 10);

      const engagementTrends = Object.entries(dailyEngagement)
        .map(([date, data]) => ({
          date,
          engagementRate: data.total / data.count,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return {
        totalPosts: contents.length,
        totalImpressions,
        totalReach,
        totalEngagements,
        averageEngagementRate,
        optimalTimes,
        topPerformingPosts,
        engagementTrends,
      };
    } catch (error) {
      console.error("Failed to generate analytics report:", error);
      return this.getEmptyReport();
    }
  }

  /**
   * Get empty report for error cases
   */
  private getEmptyReport(): AnalyticsReport {
    return {
      totalPosts: 0,
      totalImpressions: 0,
      totalReach: 0,
      totalEngagements: 0,
      averageEngagementRate: 0,
      optimalTimes: this.getDefaultOptimalTimes(),
      topPerformingPosts: [],
      engagementTrends: [],
    };
  }

  /**
   * Schedule automatic metrics collection for all posted content
   */
  async scheduleMetricsCollection(): Promise<void> {
    try {
      const postedContents = await prisma.content.findMany({
        where: {
          status: "published",
          instagramPostId: { not: null },
          // Only collect for posts that are at least 1 hour old and less than 30 days old
          postedAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
            lte: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
          },
        },
        take: 50, // Process in batches to avoid rate limiting
      });

      for (const content of postedContents) {
        await this.collectPostMetrics(content.id);
        // Add delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      console.log(`Collected metrics for ${postedContents.length} posts`);
    } catch (error) {
      console.error("Failed to schedule metrics collection:", error);
    }
  }

  /**
   * Get day name from day number
   */
  getDayName(dayOfWeek: number): string {
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    return days[dayOfWeek] ?? "Unknown";
  }

  /**
   * Format hour for display
   */
  formatHour(hour: number): string {
    if (hour === 0) return "12:00 AM";
    if (hour === 12) return "12:00 PM";
    if (hour < 12) return `${hour}:00 AM`;
    return `${hour - 12}:00 PM`;
  }
}

export const analyticsService = new AnalyticsService();
