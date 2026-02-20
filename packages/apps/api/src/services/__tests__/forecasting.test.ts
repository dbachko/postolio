import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForecastingService } from '../forecasting.js';
import { getDatabaseClient } from '../../config/database.js';

// Mock the database client (singleton shared between test and service code)
vi.mock('../../config/database.js', () => {
  const mockClient = {
    contentPublication: {
      findMany: vi.fn(),
    },
  } as any;
  return {
    getDatabaseUrl: vi.fn(() => 'postgresql://test:test@localhost:5432/test?schema=public'),
    getDatabaseClient: vi.fn(() => mockClient),
    prisma: mockClient,
  };
});

describe('ForecastingService', () => {
  let engine: ForecastingService;
  const mockBrandId = 'brand-123';
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = getDatabaseClient();
    engine = new ForecastingService();
    vi.clearAllMocks();
  });

  describe('generateForecast', () => {
    it('should return forecast report with all metrics', async () => {
      const mockPublications = createTimeSeriesData(30, 'stable');
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateForecast(mockBrandId, 30, 90);

      expect(result).toHaveProperty('brandId', mockBrandId);
      expect(result).toHaveProperty('generatedAt');
      expect(result).toHaveProperty('period', 30);
      expect(result).toHaveProperty('forecasts');

      // Check all forecast sections exist
      expect(result.forecasts).toHaveProperty('engagement');
      expect(result.forecasts).toHaveProperty('followerGrowth');
      expect(result.forecasts).toHaveProperty('engagementRate');
      expect(result.forecasts).toHaveProperty('reach');

      // Check forecast structure
      const { engagement } = result.forecasts;
      expect(engagement).toHaveProperty('current');
      expect(engagement).toHaveProperty('predicted');
      expect(engagement).toHaveProperty('trend');
      expect(engagement).toHaveProperty('confidence');
      expect(engagement.predicted).toBeInstanceOf(Array);
      expect(engagement.predicted.length).toBe(30);
    });

    it('should handle insufficient data gracefully', async () => {
      // Mock insufficient data
      const mockPublications = createTimeSeriesData(3, 'stable');
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateForecast(mockBrandId, 30, 90);

      // Should still return a valid forecast, but with low confidence
      expect(result.forecasts.engagement.confidence).toBeLessThan(50);
      expect(result.recommendations).toContain('Publish more content');
    });

    it('should generate correct number of forecast points', async () => {
      const mockPublications = createTimeSeriesData(30, 'increasing');
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const forecastDays = 45;
      const result = await engine.generateForecast(mockBrandId, forecastDays, 90);

      expect(result.forecasts.engagement.predicted).toHaveLength(forecastDays);
      expect(result.forecasts.followerGrowth.predicted).toHaveLength(forecastDays);
    });
  });

  describe('Trend Detection', () => {
    it('should detect increasing trend correctly', async () => {
      const mockPublications = createTimeSeriesData(30, 'increasing');
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateForecast(mockBrandId, 30, 90);

      expect(result.forecasts.engagement.trend).toBe('increasing');
      expect(result.forecasts.engagement.predicted[29].predicted).toBeGreaterThan(
        result.forecasts.engagement.current
      );
    });

    it('should detect decreasing trend correctly', async () => {
      const mockPublications = createTimeSeriesData(30, 'decreasing');
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateForecast(mockBrandId, 30, 90);

      expect(result.forecasts.engagement.trend).toBe('decreasing');
      expect(result.forecasts.engagement.predicted[29].predicted).toBeLessThan(
        result.forecasts.engagement.current
      );
    });

    it('should detect stable trend correctly', async () => {
      // Use deterministic, perfectly flat engagement series so that trend
      // classification is stable across runs and environments.
      const mockPublications = createTimeSeriesData(30, 'stable').map((pub) => ({
        ...pub,
        metricsLatest: {
          ...pub.metricsLatest,
          engagement: 500,
        },
      }));
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications as any);

      const result = await engine.generateForecast(mockBrandId, 30, 90);

      expect(result.forecasts.engagement.trend).toBe('stable');

      // Predicted values should be close to current (within 5%)
      const lastPredicted = result.forecasts.engagement.predicted[29].predicted;
      const current = result.forecasts.engagement.current;
      const percentChange = Math.abs((lastPredicted - current) / current) * 100;
      expect(percentChange).toBeLessThan(5);
    });
  });

  describe('Confidence Calculation', () => {
    it('should have high confidence with consistent data', async () => {
      // Create deterministic, very consistent data (low variance).
      const mockPublications = Array.from({ length: 30 }, (_, i) =>
        createPublication({
          day: i,
          engagement: 500 + (i % 5), // Tight 5-point spread
        })
      );
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateForecast(mockBrandId, 30, 90);

      expect(result.forecasts.engagement.confidence).toBeGreaterThan(70);
    });

    it('should have low confidence with volatile data', async () => {
      // Create deterministic volatile data (high variance).
      const mockPublications = Array.from({ length: 30 }, (_, i) =>
        createPublication({
          day: i,
          engagement: i % 2 === 0 ? 1500 : 100,
        })
      );
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateForecast(mockBrandId, 30, 90);

      expect(result.forecasts.engagement.confidence).toBeLessThan(60);
    });

    it('should have lower confidence with less historical data', async () => {
      const shortHistory = createTimeSeriesData(7, 'stable');
      const longHistory = createTimeSeriesData(90, 'stable');

      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(shortHistory);
      const resultShort = await engine.generateForecast(mockBrandId, 30, 7);

      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(longHistory);
      const resultLong = await engine.generateForecast(mockBrandId, 30, 90);

      expect(resultShort.forecasts.engagement.confidence).toBeLessThan(
        resultLong.forecasts.engagement.confidence
      );
    });
  });

  describe('Confidence Intervals', () => {
    it('should include confidence intervals for each prediction', async () => {
      const mockPublications = createTimeSeriesData(30, 'stable');
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateForecast(mockBrandId, 30, 90);

      for (const point of result.forecasts.engagement.predicted) {
        expect(point).toHaveProperty('confidence');
        expect(point.confidence).toHaveProperty('lower');
        expect(point.confidence).toHaveProperty('upper');
        expect(point.confidence.lower).toBeLessThan(point.predicted);
        expect(point.confidence.upper).toBeGreaterThan(point.predicted);
      }
    });

    it('should have wider confidence intervals further in the future', async () => {
      const mockPublications = createTimeSeriesData(30, 'stable');
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateForecast(mockBrandId, 30, 90);

      const firstPoint = result.forecasts.engagement.predicted[0];
      const lastPoint = result.forecasts.engagement.predicted[29];

      const firstRange = firstPoint.confidence.upper - firstPoint.confidence.lower;
      const lastRange = lastPoint.confidence.upper - lastPoint.confidence.lower;

      expect(lastRange).toBeGreaterThan(firstRange);
    });
  });

  describe('Follower Growth Forecast', () => {
    it('should calculate expected follower count', async () => {
      const mockPublications = createTimeSeriesData(30, 'increasing');
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateForecast(mockBrandId, 30, 90);

      expect(result.forecasts.followerGrowth).toHaveProperty('expectedGrowth');
      expect(result.forecasts.followerGrowth).toHaveProperty('expectedFollowers');
      expect(result.forecasts.followerGrowth.expectedFollowers).toBeGreaterThan(
        result.forecasts.followerGrowth.current
      );
    });

    it('should handle zero current followers gracefully', async () => {
      const mockPublications = createTimeSeriesData(30, 'stable').map((pub) => ({
        ...pub,
        metricsLatest: {
          ...pub.metricsLatest,
          followers: 0,
        },
      }));
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateForecast(mockBrandId, 30, 90);

      expect(result.forecasts.followerGrowth.expectedFollowers).toBeGreaterThanOrEqual(0);
      expect(result.forecasts.followerGrowth.current).toBe(0);
    });
  });

  describe('Reach Forecast', () => {
    it('should forecast reach with expected reach value', async () => {
      const mockPublications = createTimeSeriesData(30, 'increasing');
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateForecast(mockBrandId, 30, 90);

      expect(result.forecasts.reach).toHaveProperty('expectedReach');
      expect(result.forecasts.reach.expectedReach).toBeGreaterThan(0);
    });
  });

  describe('Recommendations', () => {
    it('should provide recommendations based on forecast', async () => {
      const mockPublications = createTimeSeriesData(30, 'decreasing');
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateForecast(mockBrandId, 30, 90);

      expect(result.recommendations).toBeInstanceOf(Array);
      expect(result.recommendations.length).toBeGreaterThan(0);

      // Should warn about decreasing trend
      const hasDecreasingWarning = result.recommendations.some((rec: string) =>
        rec.toLowerCase().includes('decreas')
      );
      expect(hasDecreasingWarning).toBe(true);
    });

    it('should recommend posting more content when data is sparse', async () => {
      const mockPublications = createTimeSeriesData(5, 'stable');
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateForecast(mockBrandId, 30, 90);

      const hasPublishMoreRecommendation = result.recommendations.some((rec: string) =>
        rec.toLowerCase().includes('publish more')
      );
      expect(hasPublishMoreRecommendation).toBe(true);
    });
  });

  describe('Moving Average Smoothing', () => {
    it('should smooth volatile data', async () => {
      // Create volatile data
      const mockPublications = Array(30)
        .fill(null)
        .map((_, i) =>
          createPublication({
            day: i,
            engagement: i % 2 === 0 ? 1000 : 100, // Alternating high/low
          })
        );
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateForecast(mockBrandId, 30, 90);

      // Smoothed predictions should not alternate wildly
      const predictions = result.forecasts.engagement.predicted.map((p: any) => p.predicted);
      for (let i = 1; i < predictions.length; i++) {
        const change = Math.abs(predictions[i] - predictions[i - 1]);
        // Adjacent predictions shouldn't differ by more than 50%
        expect(change / predictions[i - 1]).toBeLessThan(0.5);
      }
    });
  });
});

// Helper functions
function createTimeSeriesData(days: number, trend: 'increasing' | 'decreasing' | 'stable') {
  const baseEngagement = 500;
  const baseFollowers = 10000;
  const baseReach = 8000;

  return Array(days)
    .fill(null)
    .map((_, i) => {
      let trendFactor = 0;
      if (trend === 'increasing') {
        trendFactor = i * 20; // +20 per day
      } else if (trend === 'decreasing') {
        trendFactor = -i * 10; // -10 per day
      }

      return createPublication({
        day: i,
        engagement: baseEngagement + trendFactor + (Math.random() * 100 - 50),
        followers: baseFollowers + Math.floor(i * 10),
        reach: baseReach + trendFactor,
      });
    });
}

function createPublication(overrides: {
  day: number;
  engagement?: number;
  followers?: number;
  reach?: number;
}) {
  const baseDate = new Date('2024-01-01');
  const publishDate = new Date(baseDate);
  publishDate.setDate(publishDate.getDate() + overrides.day);

  return {
    id: `pub-${overrides.day}`,
    contentId: `content-${overrides.day}`,
    platform: 'instagram',
    publishedAt: publishDate,
    content: {
      id: `content-${overrides.day}`,
      brandId: 'brand-123',
    },
    metricsLatest: {
      id: `metrics-${overrides.day}`,
      publicationId: `pub-${overrides.day}`,
      engagement: overrides.engagement || 500,
      engagementRate: ((overrides.engagement || 500) / 10000) * 100,
      impressions: 10000,
      reach: overrides.reach || 8000,
      likes: 300,
      comments: 50,
      saves: 100,
      shares: 50,
      followers: overrides.followers || 10000,
    },
  } as any;
}
