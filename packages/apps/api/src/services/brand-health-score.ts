import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();

export interface HealthScoreFactors {
  engagementRate: number;
  followerGrowthRate: number;
  contentConsistency: number;
  commentResponseRate: number;
  publishingFrequency: number;
}

export interface HealthScoreResult {
  score: number; // 0-100
  level: 'excellent' | 'good' | 'needs_improvement' | 'action_required';
  color: string;
  factors: HealthScoreFactors;
  primaryFactor: {
    name: string;
    value: number;
    suggestion: string;
  };
}

/**
 * Calculate brand health score based on multiple factors
 *
 * Scoring Algorithm:
 * - Engagement Rate (30%): Based on avg engagement rate vs industry avg (3.5%)
 * - Follower Growth Rate (20%): Growth in last 30 days
 * - Content Consistency (20%): Regularity of posting
 * - Comment Response Rate (15%): % of comments responded to
 * - Publishing Frequency (15%): Posts per week vs optimal (3-5/week)
 */
export async function calculateBrandHealthScore(
  brandId: string,
  period: '7d' | '30d' | '90d' = '30d'
): Promise<HealthScoreResult> {
  const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Get brand publications with metrics
  const publications = await prisma.contentPublication.findMany({
    where: {
      content: { brandId },
      publishedAt: { gte: startDate },
    },
    include: {
      metricsLatest: true,
      comments: true,
      content: true,
    },
  });

  if (publications.length === 0) {
    return buildDefaultHealthScore();
  }

  // Calculate factors
  const engagementRateFactor = calculateEngagementRateFactor(publications);
  const followerGrowthFactor = await calculateFollowerGrowthFactor(brandId, startDate);
  const contentConsistencyFactor = calculateContentConsistencyFactor(publications);
  const commentResponseFactor = calculateCommentResponseFactor(publications);
  const publishingFrequencyFactor = calculatePublishingFrequencyFactor(publications, days);

  // Weighted score
  const score =
    engagementRateFactor * 0.3 +
    followerGrowthFactor * 0.2 +
    contentConsistencyFactor * 0.2 +
    commentResponseFactor * 0.15 +
    publishingFrequencyFactor * 0.15;

  const finalScore = Math.round(Math.min(100, Math.max(0, score)));

  // Determine level and color
  let level: 'excellent' | 'good' | 'needs_improvement' | 'action_required';
  let color: string;

  if (finalScore >= 80) {
    level = 'excellent';
    color = 'green';
  } else if (finalScore >= 60) {
    level = 'good';
    color = 'yellow';
  } else if (finalScore >= 40) {
    level = 'needs_improvement';
    color = 'orange';
  } else {
    level = 'action_required';
    color = 'red';
  }

  // Find primary factor (lowest score) and suggestion
  const factors: HealthScoreFactors = {
    engagementRate: Math.round(engagementRateFactor),
    followerGrowthRate: Math.round(followerGrowthFactor),
    contentConsistency: Math.round(contentConsistencyFactor),
    commentResponseRate: Math.round(commentResponseFactor),
    publishingFrequency: Math.round(publishingFrequencyFactor),
  };

  const primaryFactor = findPrimaryFactor(factors);

  return {
    score: finalScore,
    level,
    color,
    factors,
    primaryFactor,
  };
}

/**
 * Engagement Rate Factor (0-100)
 * Based on average engagement rate compared to industry average (3.5%)
 */
function calculateEngagementRateFactor(
  publications: Array<{
    metricsLatest: { engagementRate: any; impressions: number; engagement: number } | null;
  }>
): number {
  const validPubs = publications.filter((p) => p.metricsLatest && p.metricsLatest.impressions > 0);

  if (validPubs.length === 0) return 50; // Neutral if no data

  const avgEngagementRate =
    validPubs.reduce((sum, p) => {
      const rate = Number(p.metricsLatest!.engagementRate || 0);
      return sum + rate;
    }, 0) / validPubs.length;

  // Industry average is ~3.5% for Instagram
  const industryAvg = 3.5;

  // Score: 100 if 2x industry avg, 50 if at industry avg, 0 if 0
  const score = Math.min(100, (avgEngagementRate / industryAvg) * 50);

  return score;
}

/**
 * Follower Growth Factor (0-100)
 * Based on follower growth in the period
 */
async function calculateFollowerGrowthFactor(brandId: string, startDate: Date): Promise<number> {
  // Get social account follower metrics
  const socialAccounts = await prisma.socialAccount.findMany({
    where: { brandId },
    include: { accountMetricsLatest: true },
  });

  if (socialAccounts.length === 0) return 50; // Neutral

  let totalFollowers = 0;
  let totalStartFollowers = 0;

  for (const account of socialAccounts) {
    const currentFollowers = account.accountMetricsLatest?.followers || 0;
    totalFollowers += currentFollowers;

    // Try to find historical follower count
    const historicalSample = await prisma.accountMetricSample.findFirst({
      where: {
        socialAccountId: account.id,
        metricName: 'followers',
        asOf: { lte: startDate },
      },
      orderBy: { asOf: 'desc' },
    });

    const startFollowers = historicalSample ? Number(historicalSample.value) : currentFollowers;
    totalStartFollowers += startFollowers;
  }

  if (totalStartFollowers === 0) return 50; // Avoid division by zero

  const growthRate = ((totalFollowers - totalStartFollowers) / totalStartFollowers) * 100;

  // Good growth: 5% per month (~1.7% per 30 days)
  // Excellent growth: 10%+ per month (~3.3% per 30 days)
  // Score: 100 if 5%+ growth, 50 if 0% growth, 0 if -5% growth
  const score = Math.min(100, Math.max(0, 50 + growthRate * 10));

  return score;
}

/**
 * Content Consistency Factor (0-100)
 * Based on regularity of posting (standard deviation of gaps between posts)
 */
function calculateContentConsistencyFactor(
  publications: Array<{ publishedAt: Date | null }>
): number {
  const publishedDates = publications
    .filter((p) => p.publishedAt)
    .map((p) => p.publishedAt!.getTime())
    .sort((a, b) => a - b);

  if (publishedDates.length < 2) return 50; // Need at least 2 posts

  // Calculate gaps between posts (in days)
  const gaps = [];
  for (let i = 1; i < publishedDates.length; i++) {
    const gap = (publishedDates[i] - publishedDates[i - 1]) / (1000 * 60 * 60 * 24);
    gaps.push(gap);
  }

  // Calculate standard deviation
  const avgGap = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
  const variance = gaps.reduce((sum, g) => sum + Math.pow(g - avgGap, 2), 0) / gaps.length;
  const stdDev = Math.sqrt(variance);

  // Low std dev = consistent posting = high score
  // High std dev = inconsistent = low score
  // Score: 100 if stdDev < 1 day, decreases as stdDev increases
  const score = Math.max(0, 100 - stdDev * 10);

  return score;
}

/**
 * Comment Response Rate Factor (0-100)
 * Based on % of comments that have been responded to
 */
function calculateCommentResponseFactor(
  publications: Array<{
    comments: Array<{ parentExternalCommentId: string | null; externalCommentId: string }>;
  }>
): number {
  let totalComments = 0;
  let repliedComments = 0;

  for (const pub of publications) {
    const rootComments = pub.comments.filter((c) => !c.parentExternalCommentId);
    const replies = pub.comments.filter((c) => c.parentExternalCommentId);

    totalComments += rootComments.length;

    // Check which root comments have replies
    const rootCommentIds = rootComments.map((c) => c.externalCommentId);
    const repliedIds = new Set(replies.map((r) => r.parentExternalCommentId));

    repliedComments += rootCommentIds.filter((id) => repliedIds.has(id)).length;
  }

  if (totalComments === 0) return 75; // Neutral-positive if no comments yet

  const responseRate = (repliedComments / totalComments) * 100;

  // Score directly correlates with response rate
  return Math.min(100, responseRate);
}

/**
 * Publishing Frequency Factor (0-100)
 * Based on posts per week vs optimal (3-5 posts/week)
 */
function calculatePublishingFrequencyFactor(
  publications: Array<{ publishedAt: Date | null }>,
  totalDays: number
): number {
  const postsCount = publications.filter((p) => p.publishedAt).length;
  const postsPerWeek = (postsCount / totalDays) * 7;

  // Optimal: 3-5 posts per week
  // Score: 100 if in optimal range, decreases outside range
  if (postsPerWeek >= 3 && postsPerWeek <= 5) {
    return 100;
  } else if (postsPerWeek < 3) {
    // Too few posts
    return Math.max(0, (postsPerWeek / 3) * 100);
  } else {
    // Too many posts (can lead to audience fatigue)
    const excess = postsPerWeek - 5;
    return Math.max(50, 100 - excess * 10);
  }
}

/**
 * Find the lowest-scoring factor and provide suggestion
 */
function findPrimaryFactor(factors: HealthScoreFactors): {
  name: string;
  value: number;
  suggestion: string;
} {
  const factorList = [
    {
      key: 'engagementRate',
      name: 'Engagement Rate',
      value: factors.engagementRate,
      suggestion:
        'Post more engaging content (Reels, questions, interactive posts) to increase engagement rate.',
    },
    {
      key: 'followerGrowthRate',
      name: 'Follower Growth',
      value: factors.followerGrowthRate,
      suggestion: 'Increase follower growth by posting consistently and using relevant hashtags.',
    },
    {
      key: 'contentConsistency',
      name: 'Content Consistency',
      value: factors.contentConsistency,
      suggestion: 'Maintain a consistent posting schedule to build audience expectations.',
    },
    {
      key: 'commentResponseRate',
      name: 'Comment Response Rate',
      value: factors.commentResponseRate,
      suggestion:
        'Respond to comments within 2 hours to boost engagement and algorithm visibility.',
    },
    {
      key: 'publishingFrequency',
      name: 'Publishing Frequency',
      value: factors.publishingFrequency,
      suggestion: 'Aim for 3-5 posts per week for optimal engagement without audience fatigue.',
    },
  ];

  // Find lowest factor
  const lowest = factorList.reduce((min, factor) => (factor.value < min.value ? factor : min));

  return {
    name: lowest.name,
    value: lowest.value,
    suggestion: lowest.suggestion,
  };
}

/**
 * Default health score for new brands with no data
 */
function buildDefaultHealthScore(): HealthScoreResult {
  return {
    score: 50,
    level: 'needs_improvement',
    color: 'orange',
    factors: {
      engagementRate: 50,
      followerGrowthRate: 50,
      contentConsistency: 50,
      commentResponseRate: 50,
      publishingFrequency: 50,
    },
    primaryFactor: {
      name: 'Publishing Frequency',
      value: 50,
      suggestion: 'Start by publishing 3-5 posts per week to establish a consistent presence.',
    },
  };
}
