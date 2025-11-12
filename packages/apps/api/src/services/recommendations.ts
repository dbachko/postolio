import { getDatabaseClient } from '../config/database.js';
import { safePercent } from '../utils/format.js';

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
    days: number = 90
  ): Promise<RecommendationsReport> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Fetch historical data
    const publications = await prisma.contentPublication.findMany({
      where: {
        content: { brandId },
        publishedAt: { gte: startDate },
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
      if (stats.count < 2) continue; // Need at least 2 uses for reliable data

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
    // Group by day of week and hour
    const timeSlotStats = new Map<string, { engagement: number[]; count: number }>();

    for (const pub of publications) {
      if (!pub.publishedAt || !pub.metricsLatest) continue;

      const date = new Date(pub.publishedAt);
      const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' });
      const hour = date.getHours();
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
      if (stats.count < 2) continue; // Need at least 2 posts in this slot

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
    if (publications.length < 5) {
      return [
        {
          type: 'posting-frequency',
          title: 'Increase Posting Frequency',
          description:
            'Insufficient data for comprehensive analysis. Post more content to unlock insights.',
          currentValue: publications.length,
          recommendedValue: 'At least 10 posts',
          impact: 'high',
          evidence:
            'Statistical analysis requires minimum data points for reliable recommendations.',
          actionItems: [
            'Aim to publish at least 2-3 posts per week',
            'Maintain consistent posting schedule',
            'Track performance as you grow',
          ],
        },
      ];
    }

    const recommendations: ContentRecommendation[] = [];

    // 1. Caption Length Analysis
    const captionLengths = publications.map((p) => p.content?.caption?.length || 0);
    const engagementByLength = publications.map((p, i) => ({
      length: captionLengths[i],
      engagement: p.metricsLatest?.engagementRate || 0,
    }));

    // Find optimal caption length
    const shortPosts = engagementByLength.filter((e) => e.length < 100);
    const mediumPosts = engagementByLength.filter((e) => e.length >= 100 && e.length < 300);
    const longPosts = engagementByLength.filter((e) => e.length >= 300);

    const avgShort = shortPosts.length
      ? shortPosts.reduce((sum, e) => sum + e.engagement, 0) / shortPosts.length
      : 0;
    const avgMedium = mediumPosts.length
      ? mediumPosts.reduce((sum, e) => sum + e.engagement, 0) / mediumPosts.length
      : 0;
    const avgLong = longPosts.length
      ? longPosts.reduce((sum, e) => sum + e.engagement, 0) / longPosts.length
      : 0;

    const currentAvgLength = captionLengths.reduce((a, b) => a + b, 0) / captionLengths.length;
    const overallAvgEngagement = engagementByLength.length
      ? engagementByLength.reduce((s, e) => s + (e.engagement || 0), 0) / engagementByLength.length
      : 0;

    let optimalRange = 'medium (100-300 characters)';
    let bestAvg = avgMedium;
    if (avgLong > avgMedium && avgLong > avgShort) {
      optimalRange = 'long (300+ characters)';
      bestAvg = avgLong;
    } else if (avgShort > avgMedium && avgShort > avgLong) {
      optimalRange = 'short (< 100 characters)';
      bestAvg = avgShort;
    }

    // Only recommend if there's a significant difference (>15%)
    const currentCategory =
      currentAvgLength < 100 ? 'short' : currentAvgLength < 300 ? 'medium' : 'long';
    const recommendedCategory = optimalRange.split(' ')[0];

    if (currentCategory !== recommendedCategory && Math.abs(bestAvg - overallAvgEngagement) > 15) {
      recommendations.push({
        type: 'caption-length',
        title: 'Optimize Caption Length',
        description: `Posts with ${optimalRange} captions perform ${safePercent(bestAvg, 1)}% better on average.`,
        currentValue: `${Math.round(currentAvgLength)} characters (${currentCategory})`,
        recommendedValue: optimalRange,
        impact: bestAvg - overallAvgEngagement > 30 ? 'high' : 'medium',
        evidence: `Analyzed ${publications.length} posts. ${optimalRange} captions show ${safePercent(bestAvg, 1)}% avg engagement vs ${safePercent(overallAvgEngagement, 1)}% current.`,
        actionItems: [
          `Target ${optimalRange} for your next posts`,
          'Test different caption styles to find what resonates',
          'Include clear call-to-action in captions',
        ],
      });
    }

    // 2. Hashtag Count Analysis
    const hashtagCounts = publications.map((p) => {
      const caption = p.content?.caption || '';
      return this.extractHashtags(caption).length;
    });

    const engagementByHashtagCount = publications.map((p, i) => ({
      count: hashtagCounts[i],
      engagement: p.metricsLatest?.engagementRate || 0,
    }));

    // Group by hashtag count ranges
    const noHashtags = engagementByHashtagCount.filter((e) => e.count === 0);
    const fewHashtags = engagementByHashtagCount.filter((e) => e.count > 0 && e.count <= 5);
    const manyHashtags = engagementByHashtagCount.filter((e) => e.count > 5 && e.count <= 15);
    const tooManyHashtags = engagementByHashtagCount.filter((e) => e.count > 15);

    const avgNoHashtags = noHashtags.length
      ? noHashtags.reduce((sum, e) => sum + e.engagement, 0) / noHashtags.length
      : 0;
    const avgFew = fewHashtags.length
      ? fewHashtags.reduce((sum, e) => sum + e.engagement, 0) / fewHashtags.length
      : 0;
    const avgMany = manyHashtags.length
      ? manyHashtags.reduce((sum, e) => sum + e.engagement, 0) / manyHashtags.length
      : 0;
    const avgTooMany = tooManyHashtags.length
      ? tooManyHashtags.reduce((sum, e) => sum + e.engagement, 0) / tooManyHashtags.length
      : 0;

    const currentAvgHashtags = hashtagCounts.reduce((a, b) => a + b, 0) / hashtagCounts.length;
    const overallAvgEngagement2 = engagementByHashtagCount.length
      ? engagementByHashtagCount.reduce((s, e) => s + (e.engagement || 0), 0) /
        engagementByHashtagCount.length
      : 0;

    let optimalHashtagRange = '5-15 hashtags';
    let bestHashtagAvg = avgMany;
    if (avgFew > avgMany && avgFew > avgNoHashtags && avgFew > avgTooMany) {
      optimalHashtagRange = '1-5 hashtags';
      bestHashtagAvg = avgFew;
    } else if (avgNoHashtags > avgFew && avgNoHashtags > avgMany) {
      optimalHashtagRange = 'no hashtags';
      bestHashtagAvg = avgNoHashtags;
    } else if (avgTooMany > avgMany && avgTooMany > avgFew) {
      optimalHashtagRange = '15-30 hashtags';
      bestHashtagAvg = avgTooMany;
    }

    if (Math.abs(bestHashtagAvg - overallAvgEngagement2) > 10) {
      recommendations.push({
        type: 'hashtag-count',
        title: 'Optimize Hashtag Count',
        description: `Posts with ${optimalHashtagRange} perform ${safePercent(bestHashtagAvg, 1)}% better on average.`,
        currentValue: `${Math.round(currentAvgHashtags)} hashtags`,
        recommendedValue: optimalHashtagRange,
        impact: bestHashtagAvg - overallAvgEngagement2 > 20 ? 'high' : 'medium',
        evidence: `Based on ${publications.length} posts analyzed.`,
        actionItems: [
          `Use ${optimalHashtagRange} in your next posts`,
          'Focus on relevant, niche hashtags over generic ones',
          'Mix popular and niche hashtags for better reach',
        ],
      });
    }

    // 3. Posting Frequency Analysis
    const timeSpan =
      publications.length > 1
        ? (new Date(publications[0].publishedAt!).getTime() -
            new Date(publications[publications.length - 1].publishedAt!).getTime()) /
          (1000 * 60 * 60 * 24)
        : 0;

    const postsPerWeek = timeSpan > 0 ? (publications.length / timeSpan) * 7 : 0;

    if (postsPerWeek < 3) {
      recommendations.push({
        type: 'posting-frequency',
        title: 'Increase Posting Frequency',
        description:
          'You are currently posting less than 3 times per week. Consistent posting builds audience engagement.',
        currentValue: `${postsPerWeek.toFixed(1)} posts/week`,
        recommendedValue: '3-5 posts/week',
        impact: 'high',
        evidence:
          'Accounts posting 3-5 times per week see 2-3x higher engagement due to algorithmic preference and audience habits.',
        actionItems: [
          'Create a content calendar to plan ahead',
          'Batch create content to maintain consistency',
          'Use scheduling tools to automate posting',
        ],
      });
    } else if (postsPerWeek > 10) {
      recommendations.push({
        type: 'posting-frequency',
        title: 'Consider Reducing Posting Frequency',
        description:
          'Posting very frequently (10+ times/week) can lead to audience fatigue and lower per-post engagement.',
        currentValue: `${postsPerWeek.toFixed(1)} posts/week`,
        recommendedValue: '5-7 posts/week',
        impact: 'medium',
        evidence:
          'Quality over quantity: 5-7 high-quality posts typically outperform 10+ mediocre posts.',
        actionItems: [
          'Focus on creating higher-quality content',
          'Engage more with your audience between posts',
          'Use Stories or Reels for more frequent, casual updates',
        ],
      });
    }

    // 4. Content Type Analysis (if we have different types)
    const contentTypes = new Map<string, { engagement: number[]; count: number }>();

    for (const pub of publications) {
      const caption = pub.content?.caption || '';
      const type = this.inferContentType(caption);

      if (!contentTypes.has(type)) {
        contentTypes.set(type, { engagement: [], count: 0 });
      }
      const stats = contentTypes.get(type)!;
      stats.engagement.push(pub.metricsLatest?.engagementRate || 0);
      stats.count++;
    }

    if (contentTypes.size > 1) {
      const typePerformance = Array.from(contentTypes.entries()).map(([type, stats]) => ({
        type,
        avgEngagement: stats.engagement.reduce((a, b) => a + b, 0) / stats.count,
        count: stats.count,
      }));

      typePerformance.sort((a, b) => b.avgEngagement - a.avgEngagement);

      if (
        typePerformance.length > 1 &&
        typePerformance[0].avgEngagement > typePerformance[1].avgEngagement * 1.3
      ) {
        recommendations.push({
          type: 'content-type',
          title: `Focus on ${typePerformance[0].type} Content`,
          description: `Your ${typePerformance[0].type} posts significantly outperform other content types.`,
          currentValue: `Mixed content (${typePerformance.map((t) => t.type).join(', ')})`,
          recommendedValue: `More ${typePerformance[0].type} content`,
          impact: 'medium',
          evidence: `${typePerformance[0].type} posts get ${safePercent(typePerformance[0].avgEngagement, 1)}% engagement vs ${safePercent(typePerformance[1].avgEngagement, 1)}% for ${typePerformance[1].type}.`,
          actionItems: [
            `Create more ${typePerformance[0].type} content`,
            'Analyze what makes these posts successful',
            'Adapt winning elements to other content types',
          ],
        });
      }
    }

    return recommendations;
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
    if (engagementRate > 8) return 'high-performer';
    if (usageCount < 3) return 'niche';
    if (engagementRate > 5) return 'trending';
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
    if (engagementRate > 10)
      return `Consistently delivers ${safePercent(engagementRate, 1)}% engagement rate across ${usageCount} posts`;
    if (engagementRate > 7)
      return `Strong performer with ${safePercent(engagementRate, 1)}% avg engagement rate`;
    if (usageCount >= 5)
      return `Reliable choice used in ${usageCount} posts with ${safePercent(engagementRate, 1)}% engagement`;
    return `Shows promise with ${safePercent(engagementRate, 1)}% engagement`;
  }

  /**
   * Get posting time recommendation reason
   */
  private getTimingReason(avgEngagement: number, postCount: number): string {
    if (postCount >= 5)
      return `Strong data: ${postCount} posts averaging ${avgEngagement.toFixed(0)} engagements`;
    return `Based on ${postCount} posts with ${avgEngagement.toFixed(0)} avg engagements`;
  }

  /**
   * Infer content type from caption
   */
  private inferContentType(caption: string): string {
    const lower = caption.toLowerCase();

    if (lower.includes('?') || lower.includes('what') || lower.includes('how'))
      return 'question/engagement';
    if (lower.includes('tip') || lower.includes('how to') || lower.includes('guide'))
      return 'educational';
    if (lower.includes('new') || lower.includes('announcing') || lower.includes('launch'))
      return 'announcement';
    if (lower.match(/🎉|🎊|🥳|celebration/)) return 'celebration';
    if (lower.length < 50) return 'short-form';
    if (lower.length > 300) return 'story/long-form';

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

    if (hasComplex && recommendations.length > 3) return 'complex';
    if (recommendations.length > 2) return 'moderate';
    return 'easy';
  }

  /**
   * Estimate overall impact
   */
  private estimateImpact(recommendations: ContentRecommendation[]): string {
    const highImpactCount = recommendations.filter((r) => r.impact === 'high').length;

    if (highImpactCount >= 2) return '30-50% improvement potential';
    if (highImpactCount === 1) return '15-30% improvement potential';
    return '5-15% improvement potential';
  }
}
