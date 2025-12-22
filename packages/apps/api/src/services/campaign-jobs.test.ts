import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbState = {
  campaign: null as null | {
    id: string;
    brandId: string;
    config: unknown;
    brand: { id: string; name: string; styleProfile: unknown };
  },
  createdContentIds: [] as string[],
  createdContentArgs: [] as any[],
};

vi.mock('../config/database.js', () => {
  const prisma = {
    campaign: {
      update: vi.fn(async (args: any) => {
        const id = args?.where?.id as string;
        return { id, brandId: dbState.campaign?.brandId ?? 'brand-1', errorMessage: null };
      }),
      findFirst: vi.fn(async () => dbState.campaign),
    },
    content: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async (args: any) => {
        dbState.createdContentArgs.push(args);
        const id = `content-${dbState.createdContentIds.length + 1}`;
        dbState.createdContentIds.push(id);
        return { id };
      }),
    },
  } as any;

  return {
    getDatabaseClient: vi.fn(() => prisma),
  };
});

const generateInstagramContent = vi.fn(async () => [
  {
    caption: 'Hello world',
    hashtags: ['hello'],
  },
]);

vi.mock('./content-generator.js', () => ({
  generateInstagramContent,
}));

vi.mock('./broadcast-registry.js', () => ({
  getStatusBroadcaster: vi.fn(() => null),
}));

vi.mock('./assets-media.js', () => ({
  resolveGeneratedImageAsset: vi.fn(),
  attachAssetToContent: vi.fn(),
}));

vi.mock('../utils/hashtag-extractor.js', () => ({
  extractHashtagsFromCaption: vi.fn(() => []),
}));

vi.mock('./post-destination-resolver.js', () => ({
  resolvePostDestinationSocialAccountIds: vi.fn(async () => ({
    socialAccountIds: ['sa-1'],
    primarySocialAccountId: 'sa-1',
    source: 'primary',
  })),
}));

const { campaignJobService } = await import('./campaign-jobs.js');

describe('campaign jobs', () => {
  beforeEach(() => {
    dbState.createdContentIds.length = 0;
    dbState.createdContentArgs.length = 0;
    generateInstagramContent.mockClear();

    dbState.campaign = {
      id: 'camp-1',
      brandId: 'brand-1',
      brand: { id: 'brand-1', name: 'Test Brand', styleProfile: null },
      config: {
        themes: ['theme-1', 'theme-2', 'theme-3'],
        style: 'modern',
        imageProvider: 'gemini-2.5-flash',
      },
    };
  });

  it('passes campaign config imageProvider into preview generation requests', async () => {
    await campaignJobService.startCampaignPreviewGeneration('camp-1', 'user-1');

    for (let i = 0; i < 50; i++) {
      if (!campaignJobService.isJobRunning('camp-1')) break;
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(campaignJobService.isJobRunning('camp-1')).toBe(false);
    expect(generateInstagramContent).toHaveBeenCalled();

    for (const call of generateInstagramContent.mock.calls) {
      const request = call[1] as { imageProvider?: unknown };
      expect(request.imageProvider).toBe('gemini-2.5-flash');
    }

    for (const args of dbState.createdContentArgs) {
      expect(args?.data?.targetSocialAccountId).toBe('sa-1');
    }
  });
});
