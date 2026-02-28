import { safePercent } from '../../utils/format.js';
import type { ContentRecommendation } from '../recommendations.js';

interface ContentPatternAnalysisDeps {
  extractHashtags(text: string): string[];
  inferContentType(caption: string): string;
}

type Publication = {
  content?: { caption?: string | null } | null;
  metricsLatest?: { engagementRate?: number | null } | null;
  publishedAt?: Date | string | null;
};

type EngagementSample = {
  engagement: number;
};

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageEngagement(samples: EngagementSample[]): number {
  return average(samples.map((sample) => sample.engagement || 0));
}

function buildInsufficientDataRecommendation(count: number): ContentRecommendation {
  return {
    type: 'posting-frequency',
    title: 'Increase Posting Frequency',
    description:
      'Insufficient data for comprehensive analysis. Post more content to unlock insights.',
    currentValue: count,
    recommendedValue: 'At least 10 posts',
    impact: 'high',
    evidence: 'Statistical analysis requires minimum data points for reliable recommendations.',
    actionItems: [
      'Aim to publish at least 2-3 posts per week',
      'Maintain consistent posting schedule',
      'Track performance as you grow',
    ],
  };
}

function getCaptionLengthStats(publications: Publication[]) {
  const captionLengths = publications.map(
    (publication) => publication.content?.caption?.length || 0
  );
  const engagementByLength = publications.map((publication, index) => ({
    length: captionLengths[index] || 0,
    engagement: publication.metricsLatest?.engagementRate || 0,
  }));

  const shortPosts = engagementByLength.filter((entry) => entry.length < 100);
  const mediumPosts = engagementByLength.filter(
    (entry) => entry.length >= 100 && entry.length < 300
  );
  const longPosts = engagementByLength.filter((entry) => entry.length >= 300);

  return {
    captionLengths,
    averageByCategory: {
      short: averageEngagement(shortPosts),
      medium: averageEngagement(mediumPosts),
      long: averageEngagement(longPosts),
    },
    overallAvgEngagement: averageEngagement(engagementByLength),
    currentAvgLength: average(captionLengths),
  };
}

function getOptimalCaptionRange(averages: { short: number; medium: number; long: number }): {
  label: string;
  category: 'short' | 'medium' | 'long';
  bestAvg: number;
} {
  const options: Array<{ label: string; category: 'short' | 'medium' | 'long'; bestAvg: number }> =
    [
      { label: 'short (< 100 characters)', category: 'short', bestAvg: averages.short },
      { label: 'medium (100-300 characters)', category: 'medium', bestAvg: averages.medium },
      { label: 'long (300+ characters)', category: 'long', bestAvg: averages.long },
    ];

  return options.reduce(
    (best, option) => (option.bestAvg > best.bestAvg ? option : best),
    options[1]!
  );
}

function buildCaptionLengthRecommendation(
  publications: Publication[]
): ContentRecommendation | null {
  const stats = getCaptionLengthStats(publications);
  const optimal = getOptimalCaptionRange(stats.averageByCategory);
  const currentCategory =
    stats.currentAvgLength < 100 ? 'short' : stats.currentAvgLength < 300 ? 'medium' : 'long';

  if (currentCategory === optimal.category) {
    return null;
  }
  if (Math.abs(optimal.bestAvg - stats.overallAvgEngagement) < 1) {
    return null;
  }

  return {
    type: 'caption-length',
    title: 'Optimize Caption Length',
    description: `Posts with ${optimal.label} captions perform ${safePercent(optimal.bestAvg, 1)}% better on average.`,
    currentValue: `${Math.round(stats.currentAvgLength)} characters (${currentCategory})`,
    recommendedValue: optimal.label,
    impact: optimal.bestAvg - stats.overallAvgEngagement > 30 ? 'high' : 'medium',
    evidence: `Analyzed ${publications.length} posts. ${optimal.label} captions show ${safePercent(optimal.bestAvg, 1)}% avg engagement vs ${safePercent(stats.overallAvgEngagement, 1)}% current.`,
    actionItems: [
      `Target ${optimal.label} for your next posts`,
      'Test different caption styles to find what resonates',
      'Include clear call-to-action in captions',
    ],
  };
}

function getHashtagCountStats(
  publications: Publication[],
  extractHashtags: ContentPatternAnalysisDeps['extractHashtags']
) {
  const hashtagCounts = publications.map((publication) => {
    const caption = publication.content?.caption || '';
    return extractHashtags(caption).length;
  });
  const engagementByHashtagCount = publications.map((publication, index) => ({
    count: hashtagCounts[index] || 0,
    engagement: publication.metricsLatest?.engagementRate || 0,
  }));

  const noHashtags = engagementByHashtagCount.filter((entry) => entry.count === 0);
  const fewHashtags = engagementByHashtagCount.filter(
    (entry) => entry.count > 0 && entry.count <= 5
  );
  const manyHashtags = engagementByHashtagCount.filter(
    (entry) => entry.count > 5 && entry.count <= 15
  );
  const tooManyHashtags = engagementByHashtagCount.filter((entry) => entry.count > 15);

  return {
    currentAvgHashtags: average(hashtagCounts),
    overallAvgEngagement: averageEngagement(engagementByHashtagCount),
    averageByRange: {
      noHashtags: averageEngagement(noHashtags),
      few: averageEngagement(fewHashtags),
      many: averageEngagement(manyHashtags),
      tooMany: averageEngagement(tooManyHashtags),
    },
  };
}

function getOptimalHashtagRange(stats: {
  noHashtags: number;
  few: number;
  many: number;
  tooMany: number;
}): { label: string; bestAvg: number } {
  const options: Array<{ label: string; bestAvg: number }> = [
    { label: 'no hashtags', bestAvg: stats.noHashtags },
    { label: '1-5 hashtags', bestAvg: stats.few },
    { label: '5-15 hashtags', bestAvg: stats.many },
    { label: '15-30 hashtags', bestAvg: stats.tooMany },
  ];

  return options.reduce(
    (best, option) => (option.bestAvg > best.bestAvg ? option : best),
    options[2]!
  );
}

function buildHashtagCountRecommendation(
  publications: Publication[],
  extractHashtags: ContentPatternAnalysisDeps['extractHashtags']
): ContentRecommendation | null {
  const stats = getHashtagCountStats(publications, extractHashtags);
  const optimal = getOptimalHashtagRange(stats.averageByRange);
  if (Math.abs(optimal.bestAvg - stats.overallAvgEngagement) < 1) {
    return null;
  }

  return {
    type: 'hashtag-count',
    title: 'Optimize Hashtag Count',
    description: `Posts with ${optimal.label} perform ${safePercent(optimal.bestAvg, 1)}% better on average.`,
    currentValue: `${Math.round(stats.currentAvgHashtags)} hashtags`,
    recommendedValue: optimal.label,
    impact: optimal.bestAvg - stats.overallAvgEngagement > 20 ? 'high' : 'medium',
    evidence: `Based on ${publications.length} posts analyzed.`,
    actionItems: [
      `Use ${optimal.label} in your next posts`,
      'Focus on relevant, niche hashtags over generic ones',
      'Mix popular and niche hashtags for better reach',
    ],
  };
}

function getPublicationTimestamps(publications: Publication[]): number[] {
  return publications
    .map((publication) => new Date(publication.publishedAt ?? '').getTime())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
}

function calculatePostsPerWeek(publications: Publication[]): number {
  if (publications.length <= 1) {
    return 0;
  }

  const timestamps = getPublicationTimestamps(publications);
  if (timestamps.length <= 1) {
    return 0;
  }

  const min = timestamps[0]!;
  const max = timestamps[timestamps.length - 1]!;
  const spanDays = Math.max(1, (max - min) / (1000 * 60 * 60 * 24));
  const windowDays = Math.min(35, Math.ceil(spanDays));
  return (publications.length / windowDays) * 7;
}

function calculateMaxIn7Days(publications: Publication[]): number {
  const timestamps = getPublicationTimestamps(publications);
  if (timestamps.length === 0) {
    return 0;
  }

  const windowMs = 7 * 24 * 60 * 60 * 1000;
  let maxIn7Days = 0;
  let start = 0;
  for (let end = 0; end < timestamps.length; end++) {
    while (timestamps[end]! - timestamps[start]! >= windowMs) {
      start += 1;
    }
    maxIn7Days = Math.max(maxIn7Days, end - start + 1);
  }
  return maxIn7Days;
}

function buildPostingFrequencyRecommendation(
  publications: Publication[]
): ContentRecommendation | null {
  const postsPerWeek = calculatePostsPerWeek(publications);
  const maxIn7Days = calculateMaxIn7Days(publications);

  if (postsPerWeek < 3) {
    return {
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
    };
  }

  if (postsPerWeek >= 10 || maxIn7Days >= 10) {
    return {
      type: 'posting-frequency',
      title: 'Reducing Posting Frequency',
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
    };
  }

  return null;
}

function buildContentTypeRecommendation(
  publications: Publication[],
  inferContentType: ContentPatternAnalysisDeps['inferContentType']
): ContentRecommendation | null {
  const contentTypes = new Map<string, number[]>();
  for (const publication of publications) {
    const caption = publication.content?.caption || '';
    const type = inferContentType(caption);
    const engagement = publication.metricsLatest?.engagementRate || 0;
    const list = contentTypes.get(type) ?? [];
    list.push(engagement);
    contentTypes.set(type, list);
  }
  if (contentTypes.size <= 1) {
    return null;
  }

  const performance = Array.from(contentTypes.entries()).map(([type, engagement]) => ({
    type,
    avgEngagement: average(engagement),
  }));
  performance.sort((a, b) => b.avgEngagement - a.avgEngagement);

  const best = performance[0];
  const second = performance[1];
  if (!best || !second || best.avgEngagement <= second.avgEngagement * 1.3) {
    return null;
  }

  return {
    type: 'content-type',
    title: `Focus on ${best.type} Content`,
    description: `Your ${best.type} posts significantly outperform other content types.`,
    currentValue: `Mixed content (${performance.map((entry) => entry.type).join(', ')})`,
    recommendedValue: `More ${best.type} content`,
    impact: 'medium',
    evidence: `${best.type} posts get ${safePercent(best.avgEngagement, 1)}% engagement vs ${safePercent(second.avgEngagement, 1)}% for ${second.type}.`,
    actionItems: [
      `Create more ${best.type} content`,
      'Analyze what makes these posts successful',
      'Adapt winning elements to other content types',
    ],
  };
}

export function analyzeContentPatterns(
  publications: Publication[],
  deps: ContentPatternAnalysisDeps
): ContentRecommendation[] {
  if (publications.length < 5) {
    return [buildInsufficientDataRecommendation(publications.length)];
  }

  const recommendations = [
    buildCaptionLengthRecommendation(publications),
    buildHashtagCountRecommendation(publications, deps.extractHashtags),
    buildPostingFrequencyRecommendation(publications),
    buildContentTypeRecommendation(publications, deps.inferContentType),
  ];

  return recommendations.filter((recommendation): recommendation is ContentRecommendation =>
    Boolean(recommendation)
  );
}
