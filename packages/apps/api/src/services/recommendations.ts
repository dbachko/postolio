import { getDatabaseClient } from '../config/database.js';
import { safePercent } from '../utils/format.js';
import { analyzeContentPatterns } from './recommendations/content-pattern-analysis.js';

const prisma = getDatabaseClient();

export interface HashtagRecommendation {
  hashtag: string;
  score: number;
  avgEngagement: number;
  avgEngagementRate: number;
  usageCount: number;
  category: 'high-performer' | 'trending' | 'niche' | 'suggested';
  reason: string;
}

export interface PostingTimeRecommendation {
  dayOfWeek: string;
  hour: number;
  score: number;
  avgEngagement: number;
  postCount: number;
  confidence: number;
  reason: string;
}

export interface ContentRecommendation {
  type: 'caption-length' | 'posting-frequency' | 'content-type' | 'hashtag-count';
  title: string;
  description: string;
  currentValue: string | number;
  recommendedValue: string | number;
  impact: 'high' | 'medium' | 'low';
  evidence: string;
  actionItems: string[];
}

export interface RecommendationsReport {
  brandId: string;
  generatedAt: Date;
  hashtags: HashtagRecommendation[];
  postingTimes: PostingTimeRecommendation[];
  contentOptimizations: ContentRecommendation[];
  summary: {
    totalRecommendations: number;
    highImpactCount: number;
    implementationDifficulty: 'easy' | 'moderate' | 'complex';
    estimatedImpact: string;
  };
}

export class RecommendationEngine {
  /**
   * Generate comprehensive recommendations for a brand
   */
  async generateRecommendations(
    brandId: string,
    days = 90,
    options?: { socialAccountId?: string }
  ): Promise<RecommendationsReport> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Fetch historical data
    const publications = await prisma.contentPublication.findMany({
      where: {
        content: { brandId },
        publishedAt: { gte: startDate },
        ...(options?.socialAccountId ? { socialAccountId: options.socialAccountId } : {}),
      },
      include: {
        content: true,
        metricsLatest: true,
      },
      orderBy: { publishedAt: 'desc' },
    });

    // Generate recommendations
    const [hashtags, postingTimes, contentOptimizations] = await Promise.all([
      this.analyzeHashtags(publications),
      this.analyzePostingTimes(publications),
      this.analyzeContentPatterns(publications),
    ]);

    const highImpactCount = contentOptimizations.filter((r) => r.impact === 'high').length;

    return {
      brandId,
      generatedAt: new Date(),
      hashtags,
      postingTimes,
      contentOptimizations,
      summary: {
        totalRecommendations: hashtags.length + postingTimes.length + contentOptimizations.length,
        highImpactCount,
        implementationDifficulty: this.assessDifficulty(contentOptimizations),
        estimatedImpact: this.estimateImpact(contentOptimizations),
      },
    };
  }

  /**
   * Analyze hashtag performance and recommend best performers
   */
  private async analyzeHashtags(publications: any[]): Promise<HashtagRecommendation[]> {
    const hashtagStats = new Map<
      string,
      { engagement: number[]; engagementRate: number[]; count: number }
    >();

    // Aggregate hashtag performance
    for (const pub of publications) {
      const caption = pub.content?.caption || '';
      const hashtags = this.extractHashtags(caption);
      const engagement = pub.metricsLatest?.engagement || 0;
      const engagementRate = pub.metricsLatest?.engagementRate || 0;

      for (const tag of hashtags) {
        if (!hashtagStats.has(tag)) {
          hashtagStats.set(tag, { engagement: [], engagementRate: [], count: 0 });
        }
        const stats = hashtagStats.get(tag)!;
        stats.engagement.push(engagement);
        stats.engagementRate.push(engagementRate);
        stats.count++;
      }
    }

    // Calculate averages and score
    const recommendations: HashtagRecommendation[] = [];
    for (const [hashtag, stats] of hashtagStats.entries()) {
      if (stats.count < 2) {
        continue;
      } // Need at least 2 uses for reliable data

      const avgEngagement = stats.engagement.reduce((a, b) => a + b, 0) / stats.count;
      const avgEngagementRate = stats.engagementRate.reduce((a, b) => a + b, 0) / stats.count;

      // Score based on engagement rate and consistency
      const variance =
        stats.engagementRate.reduce((sum, val) => {
          const diff = val - avgEngagementRate;
          return sum + diff * diff;
        }, 0) / stats.count;
      const consistency = Math.max(0, 1 - variance / 100); // Lower variance = higher consistency
      const score = avgEngagementRate * 0.7 + consistency * 30;

      recommendations.push({
        hashtag,
        score,
        avgEngagement,
        avgEngagementRate,
        usageCount: stats.count,
        category: this.categorizeHashtag(avgEngagementRate, stats.count),
        reason: this.getHashtagReason(avgEngagementRate, avgEngagement, stats.count),
      });
    }

    // Sort by score and return top 15
    return recommendations.sort((a, b) => b.score - a.score).slice(0, 15);
  }

  /**
   * Analyze posting times and recommend optimal schedule
   */
  private async analyzePostingTimes(publications: any[]): Promise<PostingTimeRecommendation[]> {
    // Group by day of week and hour (use UTC components to avoid environment TZ differences)
    const timeSlotStats = new Map<string, { engagement: number[]; count: number }>();

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    for (const pub of publications) {
      if (!pub.publishedAt || !pub.metricsLatest) {
        continue;
      }

      const date = new Date(pub.publishedAt);
      const dayOfWeek = dayNames[date.getUTCDay()];
      const hour = date.getUTCHours();
      const key = `${dayOfWeek}-${hour}`;
      const engagement = pub.metricsLatest.engagement || 0;

      if (!timeSlotStats.has(key)) {
        timeSlotStats.set(key, { engagement: [], count: 0 });
      }
      const stats = timeSlotStats.get(key)!;
      stats.engagement.push(engagement);
      stats.count++;
    }

    // Calculate recommendations
    const recommendations: PostingTimeRecommendation[] = [];
    for (const [key, stats] of timeSlotStats.entries()) {
      if (stats.count < 2) {
        continue;
      } // Need at least 2 posts in this slot

      const [dayOfWeek, hourStr] = key.split('-');
      const hour = parseInt(hourStr);
      const avgEngagement = stats.engagement.reduce((a, b) => a + b, 0) / stats.count;

      // Confidence based on sample size
      const confidence = Math.min(100, (stats.count / 5) * 100);

      // Score combines engagement and confidence
      const score = avgEngagement * (confidence / 100);

      recommendations.push({
        dayOfWeek,
        hour,
        score,
        avgEngagement,
        postCount: stats.count,
        confidence,
        reason: this.getTimingReason(avgEngagement, stats.count),
      });
    }

    // Sort by score and return top 10
    return recommendations.sort((a, b) => b.score - a.score).slice(0, 10);
  }

  /**
   * Analyze content patterns and provide optimization recommendations
   */
  private async analyzeContentPatterns(publications: any[]): Promise<ContentRecommendation[]> {
    return analyzeContentPatterns(publications, {
      extractHashtags: (caption) => this.extractHashtags(caption),
      inferContentType: (caption) => this.inferContentType(caption),
    });
  }

  /**
   * Extract hashtags from caption
   */
  private extractHashtags(text: string): string[] {
    const hashtagRegex = /#[\w]+/g;
    const matches = text.match(hashtagRegex);
    return matches ? matches.map((tag) => tag.toLowerCase()) : [];
  }

  /**
   * Categorize hashtag performance
   */
  private categorizeHashtag(
    engagementRate: number,
    usageCount: number
  ): 'high-performer' | 'trending' | 'niche' | 'suggested' {
    if (engagementRate > 8) {
      return 'high-performer';
    }
    if (usageCount < 3) {
      return 'niche';
    }
    if (engagementRate > 5) {
      return 'trending';
    }
    return 'suggested';
  }

  /**
   * Get hashtag recommendation reason
   */
  private getHashtagReason(
    engagementRate: number,
    avgEngagement: number,
    usageCount: number
  ): string {
    if (engagementRate > 10) {
      return `Consistently delivers ${safePercent(engagementRate, 1)}% engagement rate across ${usageCount} posts`;
    }
    if (engagementRate > 7) {
      return `Strong performer with ${safePercent(engagementRate, 1)}% avg engagement rate`;
    }
    if (usageCount >= 5) {
      return `Reliable choice used in ${usageCount} posts with ${safePercent(engagementRate, 1)}% engagement`;
    }
    return `Shows promise with ${safePercent(engagementRate, 1)}% engagement`;
  }

  /**
   * Get posting time recommendation reason
   */
  private getTimingReason(avgEngagement: number, postCount: number): string {
    if (postCount >= 5) {
      return `Strong data: ${postCount} posts averaging ${avgEngagement.toFixed(0)} engagements`;
    }
    return `Based on ${postCount} posts with ${avgEngagement.toFixed(0)} avg engagements`;
  }

  /**
   * Infer content type from caption
   */
  private inferContentType(caption: string): string {
    const lower = caption.toLowerCase();

    if (lower.includes('?') || lower.includes('what') || lower.includes('how')) {
      return 'question/engagement';
    }
    if (lower.includes('tip') || lower.includes('how to') || lower.includes('guide')) {
      return 'educational';
    }
    if (lower.includes('new') || lower.includes('announcing') || lower.includes('launch')) {
      return 'announcement';
    }
    if (lower.match(/🎉|🎊|🥳|celebration/)) {
      return 'celebration';
    }
    if (lower.length < 50) {
      return 'short-form';
    }
    if (lower.length > 300) {
      return 'story/long-form';
    }

    return 'general';
  }

  /**
   * Assess overall implementation difficulty
   */
  private assessDifficulty(
    recommendations: ContentRecommendation[]
  ): 'easy' | 'moderate' | 'complex' {
    const complexTypes = ['content-type', 'posting-frequency'];
    const hasComplex = recommendations.some((r) => complexTypes.includes(r.type));

    if (hasComplex && recommendations.length > 3) {
      return 'complex';
    }
    if (recommendations.length > 2) {
      return 'moderate';
    }
    return 'easy';
  }

  /**
   * Estimate overall impact
   */
  private estimateImpact(recommendations: ContentRecommendation[]): string {
    const highImpactCount = recommendations.filter((r) => r.impact === 'high').length;

    if (highImpactCount >= 2) {
      return '30-50% improvement potential';
    }
    if (highImpactCount === 1) {
      return '15-30% improvement potential';
    }
    return '5-15% improvement potential';
  }
}
