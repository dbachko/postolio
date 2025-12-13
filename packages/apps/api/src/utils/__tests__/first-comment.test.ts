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
    let storedFirstComment: string | null = null;
    const contentCreate = vi.fn(async (args: any) => {
      storedFirstComment = args?.data?.firstComment ?? null;
      return { id: 'content-1' };
    });
    const contentFindUnique = vi.fn(async () => ({
      id: 'content-1',
      caption: 'Test caption',
      hashtags: [],
      status: 'draft',
      brandId: 'brand-1',
      campaignId: null,
      schedulingError: null,
      generationParams: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      scheduledAt: null,
      postedAt: null,
      contentType: 'post',
      shareToFeed: null,
      firstComment: storedFirstComment,
      firstCommentStatus: null,
      firstCommentPostedAt: null,
      firstCommentError: null,
      mediaAssets: [],
    }));

    const prismaMock = {
      content: {
        create: contentCreate,
        findUnique: contentFindUnique,
      },
      contentMediaAsset: {
        createMany: vi.fn(),
        upsert: vi.fn(),
        deleteMany: vi.fn(),
      },
      $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(prismaMock)),
    } as any;

    const created = await createContentInTransaction(
      {
        brandId: 'brand-1',
        caption: 'Test caption',
        contentType: 'post',
        campaignId: undefined,
        scheduledAt: undefined,
        shareToFeed: undefined,
        firstComment: '  This is my first comment  ',
        resolvedAssets: [],
      },
      prismaMock
    );

    expect(contentCreate).toHaveBeenCalledTimes(1);
    const passedData = contentCreate.mock.calls[0][0].data;
    expect(passedData.firstComment).toBe('This is my first comment');
    expect(created.firstComment).toBe('This is my first comment');
  });
});
