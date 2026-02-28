import type { ForecastReport } from './forecasting.js';

export function createDefaultForecastReport(brandId: string, forecastDays: number): ForecastReport {
  return {
    brandId,
    generatedAt: new Date(),
    period: forecastDays,
    forecasts: {
      engagement: {
        current: 0,
        predicted: [],
        trend: 'stable',
        confidence: 0,
      },
      followerGrowth: {
        current: 0,
        predicted: [],
        expectedGrowth: 0,
        expectedFollowers: 0,
        trend: 'stable',
        confidence: 0,
      },
      engagementRate: {
        current: 0,
        predicted: [],
        trend: 'stable',
        confidence: 0,
      },
      reach: {
        current: 0,
        predicted: [],
        expectedReach: 0,
        trend: 'stable',
        confidence: 0,
      },
    },
    recommendations: [
      'Publish more content',
      'Publish more content to improve forecast accuracy.',
      'Publish at least 10 posts to enable accurate forecasting.',
      'Consistent posting over 2-3 weeks will improve prediction accuracy.',
    ],
  };
}
