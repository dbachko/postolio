import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RecommendationEngine } from '../recommendations.js';
import { getDatabaseClient } from '../../config/database.js';

// Mock the database client
vi.mock('../../config/database.js', () => ({
  getDatabaseClient: vi.fn(() => ({
    contentPublication: {
      findMany: vi.fn(),
    },
  })),
}));

describe('RecommendationEngine', () => {
  let engine: RecommendationEngine;
  let mockPrisma: any;
  const mockBrandId = 'brand-123';

  beforeEach(() => {
    mockPrisma = getDatabaseClient();
    engine = new RecommendationEngine();
    vi.clearAllMocks();
  });

  describe('generateRecommendations', () => {
    it('should return recommendations with all sections when data is sufficient', async () => {
      // Mock sufficient publication data
      const mockPublications = createMockPublications(15);
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateRecommendations(mockBrandId, 90);

      expect(result).toHaveProperty('brandId', mockBrandId);
      expect(result).toHaveProperty('generatedAt');
      expect(result).toHaveProperty('hashtags');
      expect(result).toHaveProperty('postingTimes');
      expect(result).toHaveProperty('contentOptimizations');
      expect(result).toHaveProperty('summary');
      expect(result.summary).toHaveProperty('totalRecommendations');
      expect(result.summary).toHaveProperty('highImpactCount');
      expect(result.summary).toHaveProperty('implementationDifficulty');
      expect(result.summary).toHaveProperty('estimatedImpact');
    });

    it('should return minimal recommendations when data is insufficient', async () => {
      // Mock insufficient data (< 5 posts)
      const mockPublications = createMockPublications(3);
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateRecommendations(mockBrandId, 90);

      expect(result.contentOptimizations).toHaveLength(1);
      expect(result.contentOptimizations[0].type).toBe('posting-frequency');
      expect(result.contentOptimizations[0].title).toContain('Increase Posting Frequency');
    });

    it('should filter publications by date range', async () => {
      const days = 30;
      const mockPublications = createMockPublications(10);
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      await engine.generateRecommendations(mockBrandId, days);

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
  });

  describe('Hashtag Analysis', () => {
    it('should recommend high-performing hashtags', async () => {
      const mockPublications = [
        createMockPublication({
          caption: 'Great post #design #ux #product',
          engagement: 1000,
          engagementRate: 12.5,
        }),
        createMockPublication({
          caption: 'Another post #design #ux',
          engagement: 800,
          engagementRate: 10.0,
        }),
        createMockPublication({
          caption: 'More content #design #tech',
          engagement: 600,
          engagementRate: 8.0,
        }),
      ];
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateRecommendations(mockBrandId, 90);

      expect(result.hashtags.length).toBeGreaterThan(0);

      // #design should be top performer (used 3 times with good engagement)
      const designHashtag = result.hashtags.find((h) => h.hashtag === '#design');
      expect(designHashtag).toBeDefined();
      expect(designHashtag?.usageCount).toBe(3);
      expect(designHashtag?.avgEngagementRate).toBeGreaterThan(0);
    });

    it('should exclude hashtags with insufficient data (< 2 uses)', async () => {
      const mockPublications = [
        createMockPublication({
          caption: 'Post with #rare #common #common',
          engagement: 500,
          engagementRate: 5.0,
        }),
        createMockPublication({
          caption: 'Another with #common #common',
          engagement: 600,
          engagementRate: 6.0,
        }),
      ];
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateRecommendations(mockBrandId, 90);

      // #rare should be excluded (only 1 use)
      const rareHashtag = result.hashtags.find((h) => h.hashtag === '#rare');
      expect(rareHashtag).toBeUndefined();

      // #common should be included (3 uses)
      const commonHashtag = result.hashtags.find((h) => h.hashtag === '#common');
      expect(commonHashtag).toBeDefined();
    });

    it('should categorize hashtags correctly', async () => {
      const mockPublications = [
        createMockPublication({
          caption: '#highperformer #highperformer',
          engagement: 1000,
          engagementRate: 15.0, // > 8% = high-performer
        }),
        createMockPublication({
          caption: '#trending #trending',
          engagement: 500,
          engagementRate: 6.5, // 5-8% = trending
        }),
        createMockPublication({
          caption: '#trending #trending',
          engagement: 600,
          engagementRate: 7.0,
        }),
      ];
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateRecommendations(mockBrandId, 90);

      const highPerformer = result.hashtags.find((h) => h.hashtag === '#highperformer');
      expect(highPerformer?.category).toBe('high-performer');

      const trending = result.hashtags.find((h) => h.hashtag === '#trending');
      expect(trending?.category).toBe('trending');
    });
  });

  describe('Posting Time Analysis', () => {
    it('should recommend optimal posting times', async () => {
      const mockPublications = [
        createMockPublication({
          publishedAt: '2024-01-15T14:00:00Z', // Monday 2 PM
          engagement: 1000,
          engagementRate: 10.0,
        }),
        createMockPublication({
          publishedAt: '2024-01-22T14:00:00Z', // Monday 2 PM
          engagement: 1200,
          engagementRate: 12.0,
        }),
        createMockPublication({
          publishedAt: '2024-01-15T10:00:00Z', // Monday 10 AM
          engagement: 500,
          engagementRate: 5.0,
        }),
      ];
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateRecommendations(mockBrandId, 90);

      expect(result.postingTimes.length).toBeGreaterThan(0);

      // Monday 2 PM should be top recommendation
      const topTime = result.postingTimes[0];
      expect(topTime.dayOfWeek).toBe('Monday');
      expect(topTime.hour).toBe(14);
      expect(topTime.avgEngagement).toBeGreaterThan(500); // Average of 1000 and 1200
    });

    it('should exclude time slots with insufficient data (< 2 posts)', async () => {
      const mockPublications = [
        createMockPublication({
          publishedAt: '2024-01-15T14:00:00Z', // Monday 2 PM
          engagement: 1000,
          engagementRate: 10.0,
        }),
        createMockPublication({
          publishedAt: '2024-01-15T10:00:00Z', // Monday 10 AM (only 1 post)
          engagement: 500,
          engagementRate: 5.0,
        }),
      ];
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateRecommendations(mockBrandId, 90);

      // Should not include Monday 10 AM (only 1 post)
      const monday10am = result.postingTimes.find((t) => t.dayOfWeek === 'Monday' && t.hour === 10);
      expect(monday10am).toBeUndefined();
    });

    it('should calculate confidence based on sample size', async () => {
      const mockPublications = [
        // 5 posts at Monday 2 PM = high confidence
        ...Array(5)
          .fill(null)
          .map((_, i) =>
            createMockPublication({
              publishedAt: `2024-01-${15 + i * 7}T14:00:00Z`,
              engagement: 1000,
              engagementRate: 10.0,
            })
          ),
        // 2 posts at Tuesday 3 PM = lower confidence
        ...Array(2)
          .fill(null)
          .map((_, i) =>
            createMockPublication({
              publishedAt: `2024-01-${16 + i * 7}T15:00:00Z`,
              engagement: 1000,
              engagementRate: 10.0,
            })
          ),
      ];
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateRecommendations(mockBrandId, 90);

      const monday2pm = result.postingTimes.find((t) => t.dayOfWeek === 'Monday' && t.hour === 14);
      const tuesday3pm = result.postingTimes.find(
        (t) => t.dayOfWeek === 'Tuesday' && t.hour === 15
      );

      expect(monday2pm?.confidence).toBeGreaterThan(tuesday3pm?.confidence || 0);
    });
  });

  describe('Content Pattern Analysis', () => {
    it('should recommend caption length optimization', async () => {
      const mockPublications = [
        // Short captions perform worse
        ...Array(3)
          .fill(null)
          .map(() =>
            createMockPublication({
              caption: 'Short',
              engagement: 300,
              engagementRate: 3.0,
            })
          ),
        // Long captions perform better
        ...Array(3)
          .fill(null)
          .map(() =>
            createMockPublication({
              caption: 'A'.repeat(400), // 400 characters
              engagement: 800,
              engagementRate: 8.0,
            })
          ),
      ];
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateRecommendations(mockBrandId, 90);

      const captionRec = result.contentOptimizations.find((r) => r.type === 'caption-length');
      expect(captionRec).toBeDefined();
      expect(captionRec?.recommendedValue).toContain('long');
    });

    it('should recommend hashtag count optimization', async () => {
      const mockPublications = [
        // Posts with 5-15 hashtags perform better
        ...Array(3)
          .fill(null)
          .map(() =>
            createMockPublication({
              caption: Array(10).fill('#tag').join(' '),
              engagement: 800,
              engagementRate: 8.0,
            })
          ),
        // Posts with no hashtags perform worse
        ...Array(3)
          .fill(null)
          .map(() =>
            createMockPublication({
              caption: 'No hashtags here',
              engagement: 300,
              engagementRate: 3.0,
            })
          ),
      ];
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateRecommendations(mockBrandId, 90);

      const hashtagRec = result.contentOptimizations.find((r) => r.type === 'hashtag-count');
      expect(hashtagRec).toBeDefined();
      expect(hashtagRec?.recommendedValue).toContain('hashtags');
    });

    it('should recommend posting frequency increase when posting < 3 times per week', async () => {
      // 2 posts over 30 days = 0.47 posts/week
      const mockPublications = [
        createMockPublication({
          publishedAt: '2024-01-01T10:00:00Z',
          engagement: 500,
          engagementRate: 5.0,
        }),
        createMockPublication({
          publishedAt: '2024-01-30T10:00:00Z',
          engagement: 500,
          engagementRate: 5.0,
        }),
      ];
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateRecommendations(mockBrandId, 90);

      const frequencyRec = result.contentOptimizations.find((r) => r.type === 'posting-frequency');
      expect(frequencyRec).toBeDefined();
      expect(frequencyRec?.title).toContain('Increase Posting Frequency');
    });

    it('should recommend posting frequency reduction when posting > 10 times per week', async () => {
      // 50 posts over 35 days = 10 posts/week
      const startDate = new Date('2024-01-01');
      const mockPublications = Array(50)
        .fill(null)
        .map((_, i) => {
          const date = new Date(startDate);
          date.setDate(date.getDate() + i);
          return createMockPublication({
            publishedAt: date.toISOString(),
            engagement: 500,
            engagementRate: 5.0,
          });
        });
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateRecommendations(mockBrandId, 90);

      const frequencyRec = result.contentOptimizations.find((r) => r.type === 'posting-frequency');
      expect(frequencyRec).toBeDefined();
      expect(frequencyRec?.title).toContain('Reducing Posting Frequency');
    });
  });

  describe('Impact and Difficulty Assessment', () => {
    it('should assess implementation difficulty correctly', async () => {
      const mockPublications = createMockPublications(10);
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateRecommendations(mockBrandId, 90);

      expect(result.summary.implementationDifficulty).toMatch(/^(easy|moderate|complex)$/);
    });

    it('should estimate impact correctly based on high-impact recommendations', async () => {
      const mockPublications = createMockPublications(10);
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateRecommendations(mockBrandId, 90);

      expect(result.summary.estimatedImpact).toMatch(/\d+-\d+% improvement potential/);
    });

    it('should count high-impact recommendations correctly', async () => {
      const mockPublications = createMockPublications(10);
      vi.mocked(mockPrisma.contentPublication.findMany).mockResolvedValue(mockPublications);

      const result = await engine.generateRecommendations(mockBrandId, 90);

      const highImpactCount = result.contentOptimizations.filter((r) => r.impact === 'high').length;
      expect(result.summary.highImpactCount).toBe(highImpactCount);
    });
  });
});

// Helper functions
function createMockPublications(count: number) {
  return Array(count)
    .fill(null)
    .map((_, i) => createMockPublication({ publishedAt: `2024-01-${i + 1}T10:00:00Z` }));
}

function createMockPublication(
  overrides: {
    caption?: string;
    publishedAt?: string;
    engagement?: number;
    engagementRate?: number;
  } = {}
) {
  const defaults = {
    id: `pub-${Math.random()}`,
    contentId: `content-${Math.random()}`,
    platform: 'instagram',
    publishedAt: new Date('2024-01-15T10:00:00Z'),
    content: {
      id: `content-${Math.random()}`,
      caption: 'Default caption #test #example',
      brandId: 'brand-123',
    },
    metricsLatest: {
      id: `metrics-${Math.random()}`,
      publicationId: `pub-${Math.random()}`,
      engagement: 500,
      engagementRate: 5.0,
      impressions: 10000,
      reach: 8000,
      likes: 300,
      comments: 50,
      saves: 100,
      shares: 50,
    },
  };

  return {
    ...defaults,
    publishedAt: overrides.publishedAt ? new Date(overrides.publishedAt) : defaults.publishedAt,
    content: {
      ...defaults.content,
      caption: overrides.caption || defaults.content.caption,
    },
    metricsLatest: {
      ...defaults.metricsLatest,
      engagement:
        overrides.engagement !== undefined
          ? overrides.engagement
          : defaults.metricsLatest.engagement,
      engagementRate:
        overrides.engagementRate !== undefined
          ? overrides.engagementRate
          : defaults.metricsLatest.engagementRate,
    },
  } as any;
}
