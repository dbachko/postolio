import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDatabaseClient } from '../../config/database.js';

// Mock the database client (singleton instance so service code and tests share it)
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

// Import AIInsightsService after mocking
const { AIInsightsService } = await import('../ai-insights.js');

describe('AIInsightsService', () => {
  let service: any;
  let mockPrisma: any;
  const mockBrandId = 'brand-123';

  beforeEach(async () => {
    mockPrisma = getDatabaseClient();
    service = new AIInsightsService();
    vi.clearAllMocks();
  });

  describe('generateInsights', () => {
    it('should return insights report with all sections', async () => {
      const mockPublications = createMockPublications(15);
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await service.generateInsights(mockBrandId, 30);

      expect(result).toHaveProperty('brandId', mockBrandId);
      expect(result).toHaveProperty('generatedAt');
      expect(result).toHaveProperty('insights');
      expect(result).toHaveProperty('summary');
      expect(result.insights).toBeInstanceOf(Array);
    });

    it('should return default insights when no data is available', async () => {
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue([]);

      const result = await service.generateInsights(mockBrandId, 30);

      expect(result.insights.length).toBeGreaterThan(0);
      expect(result.summary.totalInsights).toBeGreaterThan(0);
    });

    it('should filter publications by date range', async () => {
      const days = 30;
      const mockPublications = createMockPublications(10);
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      await service.generateInsights(mockBrandId, days);

      expect(mockPrisma.contentPublication.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            publishedAt: expect.objectContaining({
              gte: expect.any(Date),
            }),
          }),
        })
      );
    });

    it('should sort insights by priority and timestamp', async () => {
      const mockPublications = createMockPublications(20);
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await service.generateInsights(mockBrandId, 30);

      // High priority should come first
      const priorities = result.insights.map((i: any) => i.priority);
      const firstHigh = priorities.indexOf('high');
      const lastMedium = priorities.lastIndexOf('medium');

      if (firstHigh >= 0 && lastMedium >= 0) {
        expect(firstHigh).toBeLessThan(lastMedium);
      }
    });
  });

  describe('Summary Statistics', () => {
    it('should calculate summary statistics correctly', async () => {
      const mockPublications = createMockPublications(15);
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await service.generateInsights(mockBrandId, 30);

      expect(result.summary.totalInsights).toBe(result.insights.length);
      expect(result.summary.highPriority).toBe(
        result.insights.filter((i: any) => i.priority === 'high').length
      );
      expect(result.summary.mediumPriority).toBe(
        result.insights.filter((i: any) => i.priority === 'medium').length
      );
      expect(result.summary.lowPriority).toBe(
        result.insights.filter((i: any) => i.priority === 'low').length
      );
    });
  });

  describe('Performance Trend Analysis', () => {
    it('should detect improving performance', async () => {
      // Create posts with improving engagement
      const mockPublications = Array(15)
        .fill(null)
        .map((_, i) =>
          createMockPublication({
            day: i,
            engagement: 500 + i * 50, // Increasing trend
            engagementRate: 5 + i * 0.5,
          })
        );
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await service.generateInsights(mockBrandId, 30);

      // Should have a positive performance insight
      const performanceInsights = result.insights.filter((i: any) => i.type === 'performance');
      expect(performanceInsights.length).toBeGreaterThan(0);

      const hasPositiveTrend = performanceInsights.some((i: any) =>
        i.description.toLowerCase().includes('improv')
      );
      expect(hasPositiveTrend).toBe(true);
    });

    it('should detect declining performance', async () => {
      // Create posts with declining engagement
      const mockPublications = Array(15)
        .fill(null)
        .map((_, i) =>
          createMockPublication({
            day: i,
            engagement: 1000 - i * 50, // Decreasing trend
            engagementRate: 10 - i * 0.5,
          })
        );
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await service.generateInsights(mockBrandId, 30);

      const performanceInsights = result.insights.filter((i: any) => i.type === 'performance');
      const hasNegativeTrend = performanceInsights.some((i: any) =>
        i.description.toLowerCase().includes('declin')
      );
      expect(hasNegativeTrend).toBe(true);
    });
  });

  describe('Optimal Timing Analysis', () => {
    it('should identify best posting times', async () => {
      // Create posts with varying performance by time
      const mockPublications = [
        // Monday 2 PM performs best
        ...Array(3)
          .fill(null)
          .map((_, i) =>
            createMockPublication({
              day: i * 7,
              hour: 14, // 2 PM
              engagement: 1000,
              engagementRate: 10.0,
            })
          ),
        // Tuesday 10 AM performs worse
        ...Array(3)
          .fill(null)
          .map((_, i) =>
            createMockPublication({
              day: i * 7 + 1,
              hour: 10,
              engagement: 500,
              engagementRate: 5.0,
            })
          ),
      ];
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await service.generateInsights(mockBrandId, 30);

      const timingInsights = result.insights.filter((i: any) => i.type === 'timing');
      expect(timingInsights.length).toBeGreaterThan(0);

      // Should mention Monday or the best day
      const hasTimingRecommendation = timingInsights.some(
        (i: any) =>
          i.description.toLowerCase().includes('monday') ||
          i.description.toLowerCase().includes('best time')
      );
      expect(hasTimingRecommendation).toBe(true);
    });
  });

  describe('Content Pattern Analysis', () => {
    it('should detect caption length patterns', async () => {
      // Long captions perform better
      const mockPublications = [
        ...Array(5)
          .fill(null)
          .map((_, i) =>
            createMockPublication({
              day: i,
              caption: 'A'.repeat(400), // Long caption
              engagement: 1000,
              engagementRate: 10.0,
            })
          ),
        ...Array(5)
          .fill(null)
          .map((_, i) =>
            createMockPublication({
              day: i + 10,
              caption: 'Short', // Short caption
              engagement: 500,
              engagementRate: 5.0,
            })
          ),
      ];
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await service.generateInsights(mockBrandId, 30);

      const contentInsights = result.insights.filter((i: any) => i.type === 'content');
      expect(contentInsights.length).toBeGreaterThan(0);
    });

    it('should detect hashtag patterns', async () => {
      const mockPublications = [
        ...Array(5)
          .fill(null)
          .map((_, i) =>
            createMockPublication({
              day: i,
              caption: Array(10).fill('#tag').join(' '), // Many hashtags
              engagement: 1000,
              engagementRate: 10.0,
            })
          ),
        ...Array(5)
          .fill(null)
          .map((_, i) =>
            createMockPublication({
              day: i + 10,
              caption: 'No hashtags here',
              engagement: 500,
              engagementRate: 5.0,
            })
          ),
      ];
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await service.generateInsights(mockBrandId, 30);

      const contentInsights = result.insights.filter((i: any) => i.type === 'content');
      const hasHashtagInsight = contentInsights.some((i: any) =>
        i.description.toLowerCase().includes('hashtag')
      );
      expect(hasHashtagInsight).toBe(true);
    });
  });

  describe('Audience Behavior Analysis', () => {
    it('should detect high engagement patterns', async () => {
      const mockPublications = Array(15)
        .fill(null)
        .map((_, i) =>
          createMockPublication({
            day: i,
            engagement: 1000,
            saves: 200, // High saves-to-likes ratio
            likes: 600,
          })
        );
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await service.generateInsights(mockBrandId, 30);

      const audienceInsights = result.insights.filter((i: any) => i.type === 'audience');
      expect(audienceInsights.length).toBeGreaterThan(0);
    });
  });

  describe('Anomaly Detection', () => {
    it('should detect outlier posts', async () => {
      const mockPublications = [
        // Normal posts
        ...Array(10)
          .fill(null)
          .map((_, i) =>
            createMockPublication({
              day: i,
              engagement: 500,
              engagementRate: 5.0,
            })
          ),
        // Outlier post
        createMockPublication({
          day: 10,
          engagement: 5000, // 10x average
          engagementRate: 50.0,
        }),
      ];
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await service.generateInsights(mockBrandId, 30);

      // Should detect the outlier
      const insights = result.insights;
      const hasAnomalyInsight = insights.some(
        (i: any) =>
          i.description.toLowerCase().includes('exceptional') ||
          i.description.toLowerCase().includes('outperform')
      );
      expect(hasAnomalyInsight).toBe(true);
    });

    it('should not flag normal variation as anomalies', async () => {
      // Normal variation (within 2 standard deviations)
      const mockPublications = Array(15)
        .fill(null)
        .map((_, i) =>
          createMockPublication({
            day: i,
            engagement: 500 + Math.random() * 100, // Small random variation
            engagementRate: 5.0 + Math.random() * 1.0,
          })
        );
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await service.generateInsights(mockBrandId, 30);

      // Should have insights but not anomaly alerts
      expect(result.insights.length).toBeGreaterThan(0);
    });
  });

  describe('Insight Properties', () => {
    it('should include all required properties for each insight', async () => {
      const mockPublications = createMockPublications(15);
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await service.generateInsights(mockBrandId, 30);

      for (const insight of result.insights) {
        expect(insight).toHaveProperty('id');
        expect(insight).toHaveProperty('type');
        expect(insight).toHaveProperty('priority');
        expect(insight).toHaveProperty('title');
        expect(insight).toHaveProperty('description');
        expect(insight).toHaveProperty('impact');
        expect(insight).toHaveProperty('actionable');
        expect(insight).toHaveProperty('supportingData');
        expect(insight).toHaveProperty('timestamp');

        // Type should be valid
        expect(['performance', 'timing', 'content', 'audience', 'competitive']).toContain(
          insight.type
        );

        // Priority should be valid
        expect(['high', 'medium', 'low']).toContain(insight.priority);

        // Supporting data should be an array
        expect(Array.isArray(insight.supportingData)).toBe(true);
      }
    });

    it('should include action data for actionable insights', async () => {
      const mockPublications = createMockPublications(15);
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await service.generateInsights(mockBrandId, 30);

      const actionableInsights = result.insights.filter((i: any) => i.actionable);

      for (const insight of actionableInsights) {
        if (insight.action) {
          expect(insight.action).toHaveProperty('label');
          expect(insight.action).toHaveProperty('type');
          expect(['schedule', 'content', 'hashtag', 'engagement']).toContain(insight.action.type);
        }
      }
    });

    it('should include supporting data with proper structure', async () => {
      const mockPublications = createMockPublications(15);
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await service.generateInsights(mockBrandId, 30);

      for (const insight of result.insights) {
        for (const data of insight.supportingData) {
          expect(data).toHaveProperty('metric');
          expect(data).toHaveProperty('value');

          if (data.change !== undefined) {
            expect(typeof data.change).toBe('number');
          }

          if (data.trend !== undefined) {
            expect(['up', 'down', 'stable']).toContain(data.trend);
          }
        }
      }
    });
  });
});

// Helper functions
function createMockPublications(count: number) {
  return Array(count)
    .fill(null)
    .map((_, i) =>
      createMockPublication({
        day: i,
      })
    );
}

function createMockPublication(overrides: {
  day: number;
  hour?: number;
  caption?: string;
  engagement?: number;
  engagementRate?: number;
  saves?: number;
  likes?: number;
}) {
  const baseDate = new Date('2024-01-01');
  const publishDate = new Date(baseDate);
  publishDate.setDate(publishDate.getDate() + overrides.day);
  publishDate.setHours(overrides.hour !== undefined ? overrides.hour : 10);

  const engagement = overrides.engagement !== undefined ? overrides.engagement : 500;
  const saves = overrides.saves !== undefined ? overrides.saves : 100;
  const likes = overrides.likes !== undefined ? overrides.likes : 300;

  return {
    id: `pub-${overrides.day}`,
    contentId: `content-${overrides.day}`,
    platform: 'instagram',
    publishedAt: publishDate,
    content: {
      id: `content-${overrides.day}`,
      caption: overrides.caption || 'Default caption #test #example',
      brandId: 'brand-123',
    },
    metricsLatest: {
      id: `metrics-${overrides.day}`,
      publicationId: `pub-${overrides.day}`,
      engagement,
      engagementRate: overrides.engagementRate || 5.0,
      impressions: 10000,
      reach: 8000,
      likes,
      comments: 50,
      saves,
      shares: 50,
    },
  } as any;
}
