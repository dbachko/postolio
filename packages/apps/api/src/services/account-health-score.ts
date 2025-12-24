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
      name: 'Engagement Rate',
      value: 50,
      suggestion: 'Publish consistently and experiment with content formats to improve engagement.',
    },
  };
}

function clamp0to100(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)));
}

function calculateEngagementRateFactor(publications: Array<{ metricsLatest: any | null }>): number {
  const valid = publications.filter(
    (p) => p.metricsLatest && (p.metricsLatest.impressions || 0) > 0
  );
  if (valid.length === 0) return 50;

  const avgEngagementRate =
    valid.reduce((sum, p) => sum + Number(p.metricsLatest.engagementRate || 0), 0) / valid.length;

  const industryAvg = 3.5;
  const score = Math.min(100, (avgEngagementRate / industryAvg) * 50);
  return score;
}

async function calculateFollowerGrowthFactor(
  socialAccountId: string,
  startDate: Date
): Promise<number> {
  const account = await prisma.socialAccount.findUnique({
    where: { id: socialAccountId },
    include: { accountMetricsLatest: true },
  });

  if (!account) return 50;

  const currentFollowers = account.accountMetricsLatest?.followers || 0;
  const historicalSample = await prisma.accountMetricSample.findFirst({
    where: {
      socialAccountId,
      metricName: 'followers',
      asOf: { lte: startDate },
    },
    orderBy: { asOf: 'desc' },
  });

  const startFollowers = historicalSample ? Number(historicalSample.value) : currentFollowers;
  if (startFollowers <= 0) return 50;

  const growthRate = ((currentFollowers - startFollowers) / startFollowers) * 100;
  const score = Math.min(100, Math.max(0, 50 + growthRate * 10));
  return score;
}

function calculateContentConsistencyFactor(
  publications: Array<{ publishedAt: Date | null }>
): number {
  const publishedDates = publications
    .filter((p) => p.publishedAt)
    .map((p) => p.publishedAt!.getTime())
    .sort((a, b) => a - b);

  if (publishedDates.length < 2) return 50;

  const gaps: number[] = [];
  for (let i = 1; i < publishedDates.length; i++) {
    gaps.push((publishedDates[i] - publishedDates[i - 1]) / (1000 * 60 * 60 * 24));
  }

  const avgGap = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
  const variance = gaps.reduce((sum, g) => sum + Math.pow(g - avgGap, 2), 0) / gaps.length;
  const stdDev = Math.sqrt(variance);

  return Math.max(0, 100 - stdDev * 10);
}

function calculatePublishingFrequencyFactor(
  publications: Array<{ publishedAt: Date | null }>,
  days: number
): number {
  const postCount = publications.filter((p) => p.publishedAt).length;
  const weeks = Math.max(1, days / 7);
  const postsPerWeek = postCount / weeks;

  if (postsPerWeek >= 5) return 100;
  if (postsPerWeek >= 3) return 80;
  if (postsPerWeek >= 2) return 60;
  if (postsPerWeek >= 1) return 40;
  return 20;
}

function findPrimaryFactor(factors: HealthScoreFactors): HealthScoreResult['primaryFactor'] {
  const items: Array<{
    key: keyof HealthScoreFactors;
    name: string;
    value: number;
    suggestion: string;
  }> = [
    {
      key: 'engagementRate',
      name: 'Engagement Rate',
      value: factors.engagementRate,
      suggestion: 'Try new content formats and stronger hooks to increase engagement.',
    },
    {
      key: 'followerGrowthRate',
      name: 'Follower Growth',
      value: factors.followerGrowthRate,
      suggestion: 'Post consistently and use collaborations to grow followers.',
    },
    {
      key: 'contentConsistency',
      name: 'Content Consistency',
      value: factors.contentConsistency,
      suggestion: 'Keep a steady posting schedule to build momentum.',
    },
    {
      key: 'publishingFrequency',
      name: 'Publishing Frequency',
      value: factors.publishingFrequency,
      suggestion: 'Aim for 3–5 posts per week to stay top of mind.',
    },
  ];

  items.sort((a, b) => a.value - b.value);
  const best = items[0];
  return { name: best.name, value: best.value, suggestion: best.suggestion };
}

export async function calculateAccountHealthScore(
  socialAccountId: string,
  period: '7d' | '30d' | '90d' = '30d'
): Promise<HealthScoreResult> {
  const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const publications = await prisma.contentPublication.findMany({
    where: { socialAccountId, publishedAt: { gte: startDate } },
    include: { metricsLatest: true },
  });

  if (publications.length === 0) {
    return buildDefaultHealthScore();
  }

  const engagementRateFactor = calculateEngagementRateFactor(publications);
  const followerGrowthFactor = await calculateFollowerGrowthFactor(socialAccountId, startDate);
  const contentConsistencyFactor = calculateContentConsistencyFactor(publications);
  const publishingFrequencyFactor = calculatePublishingFrequencyFactor(publications, days);

  // Response rate is not currently measurable reliably per account; do not weight it.
  const commentResponseFactor = 100;

  const score =
    engagementRateFactor * 0.35 +
    followerGrowthFactor * 0.25 +
    contentConsistencyFactor * 0.2 +
    publishingFrequencyFactor * 0.2;

  const finalScore = clamp0to100(score);

  let level: HealthScoreResult['level'];
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

  const factors: HealthScoreFactors = {
    engagementRate: clamp0to100(engagementRateFactor),
    followerGrowthRate: clamp0to100(followerGrowthFactor),
    contentConsistency: clamp0to100(contentConsistencyFactor),
    commentResponseRate: clamp0to100(commentResponseFactor),
    publishingFrequency: clamp0to100(publishingFrequencyFactor),
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
