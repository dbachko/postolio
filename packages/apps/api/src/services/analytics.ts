import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();

export interface AnalyticsReport {
  totalPosts: number;
  totalImpressions: number;
  totalReach: number;
  totalEngagements: number;
  averageEngagementRate: number;
  optimalTimes: Array<{
    dayOfWeek: number;
    hour: number;
    engagementScore: number;
    sampleSize: number;
  }>;
  topPerformingPosts: Array<{
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
  }>;
  engagementTrends: Array<{ date: string; engagementRate: number }>;
}

class AnalyticsServiceV2Compat {
  private defaultOptimalTimes() {
    return [
      { dayOfWeek: 2, hour: 11, engagementScore: 8.5, sampleSize: 0 },
      { dayOfWeek: 3, hour: 14, engagementScore: 8.2, sampleSize: 0 },
      { dayOfWeek: 4, hour: 10, engagementScore: 8.0, sampleSize: 0 },
    ];
  }

  async generateAnalyticsReport(brandId: string): Promise<AnalyticsReport> {
    const pubs = await prisma.contentPublication.findMany({
      where: { content: { brandId } },
      select: { publishedAt: true, metricsLatest: true, id: true },
    });
    let totalImpressions = 0;
    let totalReach = 0;
    let totalEngagements = 0;
    const posts: AnalyticsReport['topPerformingPosts'] = [];
    for (const p of pubs) {
      const m = p.metricsLatest;
      if (!m) continue;
      totalImpressions += m.impressions || 0;
      totalReach += m.reach || 0;
      totalEngagements += m.engagement || 0;
      const ts = p.publishedAt || new Date();
      posts.push({
        postId: p.id,
        impressions: m.impressions || 0,
        reach: m.reach || 0,
        likes: m.likes || 0,
        comments: m.comments || 0,
        saves: m.saves || 0,
        shares: m.shares || 0,
        engagementRate: Number(m.engagementRate || 0),
        timestamp: ts,
        dayOfWeek: ts.getDay(),
        hourOfDay: ts.getHours(),
      });
    }
    const averageEngagementRate =
      totalImpressions > 0 ? (totalEngagements / totalImpressions) * 100 : 0;
    return {
      totalPosts: pubs.length,
      totalImpressions,
      totalReach,
      totalEngagements,
      averageEngagementRate,
      optimalTimes: this.defaultOptimalTimes(),
      topPerformingPosts: posts.sort((a, b) => b.engagementRate - a.engagementRate).slice(0, 10),
      engagementTrends: [],
    };
  }

  // Backwards-compat helpers (used by routes)
  getDayName(dayOfWeek: number): string {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[dayOfWeek] ?? 'Unknown';
  }
  formatHour(hour: number): string {
    if (hour === 0) return '12:00 AM';
    if (hour === 12) return '12:00 PM';
    if (hour < 12) return `${hour}:00 AM`;
    return `${hour - 12}:00 PM`;
  }
  // Legacy stubs retained for API surface compatibility
  async scheduleMetricsCollection(): Promise<void> {
    return;
  }
  async collectPostMetrics(): Promise<null> {
    return null;
  }
  async analyzeOptimalTimes() {
    return this.defaultOptimalTimes();
  }
  async getSchedulingRecommendation() {
    const now = new Date();
    now.setHours(now.getHours() + 2, 0, 0, 0);
    return { recommendedTime: now, confidence: 60, reason: 'Default', alternativeTimes: [] };
  }
}

export const analyticsService = new AnalyticsServiceV2Compat();
