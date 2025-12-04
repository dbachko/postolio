import { describe, expect, it, vi } from 'vitest';
import {
  validateRequestBody,
  createContentInTransaction,
  type CreateManualContentBody,
} from '../content-management.js';

describe('firstComment handling in content management', () => {
  it('accepts a valid firstComment during validation', () => {
    const body: CreateManualContentBody = {
      brandId: 'brand-1',
      caption: 'Test caption',
      mediaType: 'image',
      contentType: 'post',
      assetIds: ['asset-1'],
      firstComment: '  This is my first comment  ',
    };

    const result = validateRequestBody(body);
    expect(result.ok).toBe(true);
  });

  it('rejects non-string firstComment', () => {
    const body = {
      brandId: 'brand-1',
      caption: 'Test caption',
      mediaType: 'image',
      contentType: 'post',
      assetIds: ['asset-1'],
      // Intentionally wrong type
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      firstComment: 123 as any,
    } satisfies CreateManualContentBody as any;

    const result = validateRequestBody(body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.error).toContain('firstComment must be a string');
    }
  });

  it('rejects overly long firstComment', () => {
    const body: CreateManualContentBody = {
      brandId: 'brand-1',
      caption: 'Test caption',
      mediaType: 'image',
      contentType: 'post',
      assetIds: ['asset-1'],
      firstComment: 'x'.repeat(2201),
    };

    const result = validateRequestBody(body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.error).toContain('firstComment must be at most 2200 characters');
    }
  });

  it('trims and persists firstComment in createContentInTransaction', async () => {
    const contentCreate = vi.fn(async (args: any) => {
      const { data, select } = args;
      const base = {
        id: 'content-1',
        caption: data.caption,
        primaryAssetCdnUrl: null,
        primaryAssetId: null,
        primaryAssetHeight: null,
        primaryAssetWidth: null,
        status: data.status ?? 'draft',
        brandId: data.brandId,
        generationParams: data.generationParams,
        createdAt: new Date(),
        mediaType: data.mediaType ?? 'image',
        contentType: data.contentType ?? 'post',
        videoUrl: data.videoUrl ?? null,
        shareToFeed: data.shareToFeed ?? null,
        firstComment: data.firstComment ?? null,
      };
      if (!select) return base;
      const picked: any = {};
      for (const key of Object.keys(select)) {
        if (select[key]) picked[key] = (base as any)[key];
      }
      return picked;
    });

    const prismaMock = {
      content: {
        create: contentCreate,
      },
      postMediaAsset: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(prismaMock)),
    } as any;

    const created = await createContentInTransaction(
      {
        brandId: 'brand-1',
        caption: 'Test caption',
        mediaType: 'image',
        contentType: 'post',
        videoUrl: undefined,
        campaignId: undefined,
        scheduledAt: undefined,
        shareToFeed: undefined,
        firstComment: '  This is my first comment  ',
        resolvedAsset: null,
        resolvedCarouselAssets: null,
      },
      prismaMock
    );

    expect(contentCreate).toHaveBeenCalledTimes(1);
    const passedData = contentCreate.mock.calls[0][0].data;
    expect(passedData.firstComment).toBe('This is my first comment');
    expect(created.firstComment).toBe('This is my first comment');
  });
});
