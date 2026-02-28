import { safePercent } from '../utils/format.js';
import type { AIInsight } from './ai-insights.js';

function buildCaptionLengthInsight(validPubs: any[]): AIInsight | null {
  const captionData = validPubs
    .filter((p) => p.content.caption)
    .map((p) => ({
      length: (p.content.caption || '').length,
      engagement: Number(p.metricsLatest.engagementRate || 0),
    }));

  if (captionData.length < 10) {
    return null;
  }

  captionData.sort((a, b) => a.length - b.length);
  const shortCaptions = captionData.slice(0, Math.floor(captionData.length / 4));
  const longCaptions = captionData.slice(-Math.floor(captionData.length / 4));
  const shortAvg = shortCaptions.reduce((sum, d) => sum + d.engagement, 0) / shortCaptions.length;
  const longAvg = longCaptions.reduce((sum, d) => sum + d.engagement, 0) / longCaptions.length;
  if (Math.abs(shortAvg - longAvg) / Math.max(shortAvg, longAvg) <= 0.2) {
    return null;
  }

  const better = shortAvg > longAvg ? 'shorter' : 'longer';
  const betterAvg = shortAvg > longAvg ? shortAvg : longAvg;
  const worseAvg = shortAvg > longAvg ? longAvg : shortAvg;

  return {
    id: `content-caption-${Date.now()}`,
    type: 'content',
    priority: 'medium',
    title: `${better === 'shorter' ? 'Shorter' : 'Longer'} Captions Perform Better`,
    description: `Your ${better} captions (${better === 'shorter' ? 'under 100' : 'over 200'} characters) get ${safePercent((betterAvg / worseAvg - 1) * 100, 0)}% more engagement.`,
    impact: 'Adjusting your caption strategy could improve overall engagement rates.',
    actionable: true,
    action: { label: 'View Caption Best Practices', type: 'content' },
    supportingData: [
      {
        metric: `${better === 'shorter' ? 'Short' : 'Long'} Caption Engagement`,
        value: `${safePercent(betterAvg, 2)}%`,
      },
      {
        metric: `${better === 'shorter' ? 'Long' : 'Short'} Caption Engagement`,
        value: `${safePercent(worseAvg, 2)}%`,
      },
    ],
    timestamp: new Date(),
  };
}

function buildHashtagUsageInsight(validPubs: any[]): AIInsight | null {
  const hashtagStats = validPubs.reduce(
    (acc, p) => {
      const caption: string = p.content.caption || '';
      const hasHashtag = /#\w+/.test(caption);
      const er = Number(p.metricsLatest.engagementRate || 0);
      if (hasHashtag) {
        acc.with.count += 1;
        acc.with.total += er;
      } else {
        acc.without.count += 1;
        acc.without.total += er;
      }
      return acc;
    },
    { with: { count: 0, total: 0 }, without: { count: 0, total: 0 } }
  );

  if (hashtagStats.with.count + hashtagStats.without.count < 10) {
    return null;
  }

  const avgWith =
    hashtagStats.with.count > 0 ? hashtagStats.with.total / hashtagStats.with.count : 0;
  const avgWithout =
    hashtagStats.without.count > 0 ? hashtagStats.without.total / hashtagStats.without.count : 0;
  if (avgWith === 0 && avgWithout === 0) {
    return null;
  }

  const betterWith = avgWith >= avgWithout;
  const better = betterWith ? 'with' : 'without';
  const betterAvg = betterWith ? avgWith : avgWithout;
  const worseAvg = betterWith ? avgWithout : avgWith;
  if (worseAvg !== 0 && Math.abs((betterAvg - worseAvg) / worseAvg) <= 0.1) {
    return null;
  }

  return {
    id: `content-hashtag-${Date.now()}`,
    type: 'content',
    priority: 'medium',
    title: 'Hashtag Usage Impact',
    description: `Posts ${better} hashtags see ${safePercent((betterAvg / Math.max(worseAvg, 0.0001) - 1) * 100, 0)}% different engagement. Consider optimizing hashtag usage.`,
    impact: 'Using the right number of hashtags can improve discoverability and engagement.',
    actionable: true,
    action: {
      label: 'Refine Hashtag Strategy',
      type: 'hashtag',
    },
    supportingData: [
      { metric: 'With Hashtags Avg ER', value: `${safePercent(avgWith, 2)}%` },
      { metric: 'Without Hashtags Avg ER', value: `${safePercent(avgWithout, 2)}%` },
    ],
    timestamp: new Date(),
  };
}

export function analyzeContentPatterns(publications: any[]): AIInsight[] {
  const insights: AIInsight[] = [];
  const validPubs = publications.filter((p) => p.metricsLatest);
  if (validPubs.length < 10) {
    return insights;
  }

  const captionInsight = buildCaptionLengthInsight(validPubs);
  if (captionInsight) {
    insights.push(captionInsight);
  }

  const hashtagInsight = buildHashtagUsageInsight(validPubs);
  if (hashtagInsight) {
    insights.push(hashtagInsight);
  }

  return insights;
}
