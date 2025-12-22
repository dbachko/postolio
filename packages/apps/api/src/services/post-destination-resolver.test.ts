import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbState = {
  preferences: {} as unknown,
  accounts: [] as Array<{
    id: string;
    metadata: unknown;
    sortOrder: number;
    createdAt: Date;
  }>,
};

vi.mock('../config/database.js', () => {
  const prisma = {
    brand: {
      findUnique: vi.fn(async () => ({ preferences: dbState.preferences })),
    },
    socialAccount: {
      findMany: vi.fn(async () => dbState.accounts),
    },
  } as any;

  return {
    getDatabaseClient: vi.fn(() => prisma),
  };
});

const { resolvePostDestinationSocialAccountIds } = await import('./post-destination-resolver.js');

describe('post destination resolver', () => {
  beforeEach(() => {
    dbState.preferences = {};
    dbState.accounts = [];
  });

  it('returns brand defaults when configured (filtering disconnected)', async () => {
    dbState.preferences = { defaultPostSocialAccountIds: ['sa-2', 'sa-1', 'sa-3', 'sa-3'] };
    dbState.accounts = [
      { id: 'sa-1', metadata: {}, sortOrder: 0, createdAt: new Date('2025-01-01T00:00:00Z') },
      {
        id: 'sa-2',
        metadata: { disconnected: true },
        sortOrder: 1,
        createdAt: new Date('2025-01-02T00:00:00Z'),
      },
      { id: 'sa-3', metadata: {}, sortOrder: 2, createdAt: new Date('2025-01-03T00:00:00Z') },
    ];

    const res = await resolvePostDestinationSocialAccountIds({ brandId: 'brand-1' });
    expect(res.source).toBe('brand_defaults');
    expect(res.primarySocialAccountId).toBe('sa-1');
    expect(res.socialAccountIds).toEqual(['sa-1', 'sa-3']);
  });

  it('falls back to primary when no defaults exist', async () => {
    dbState.preferences = {};
    dbState.accounts = [
      { id: 'sa-2', metadata: {}, sortOrder: 0, createdAt: new Date('2025-01-01T00:00:00Z') },
      { id: 'sa-1', metadata: {}, sortOrder: 1, createdAt: new Date('2025-01-02T00:00:00Z') },
    ];

    const res = await resolvePostDestinationSocialAccountIds({ brandId: 'brand-1' });
    expect(res.source).toBe('primary');
    expect(res.primarySocialAccountId).toBe('sa-2');
    expect(res.socialAccountIds).toEqual(['sa-2']);
  });

  it('uses explicit destinations when provided', async () => {
    dbState.preferences = { defaultPostSocialAccountIds: ['sa-1'] };
    dbState.accounts = [
      { id: 'sa-1', metadata: {}, sortOrder: 0, createdAt: new Date('2025-01-01T00:00:00Z') },
      { id: 'sa-2', metadata: {}, sortOrder: 1, createdAt: new Date('2025-01-02T00:00:00Z') },
      { id: 'sa-3', metadata: {}, sortOrder: 2, createdAt: new Date('2025-01-03T00:00:00Z') },
    ];

    const res = await resolvePostDestinationSocialAccountIds({
      brandId: 'brand-1',
      explicitSocialAccountIds: ['sa-3', 'sa-1'],
    });
    expect(res.source).toBe('explicit');
    expect(res.socialAccountIds).toEqual(['sa-3', 'sa-1']);
  });

  it('falls back to primary if explicit destinations are invalid', async () => {
    dbState.preferences = { defaultPostSocialAccountIds: ['sa-1'] };
    dbState.accounts = [
      { id: 'sa-1', metadata: {}, sortOrder: 0, createdAt: new Date('2025-01-01T00:00:00Z') },
      { id: 'sa-2', metadata: {}, sortOrder: 1, createdAt: new Date('2025-01-02T00:00:00Z') },
    ];

    const res = await resolvePostDestinationSocialAccountIds({
      brandId: 'brand-1',
      explicitSocialAccountIds: ['missing'],
    });
    expect(res.source).toBe('primary');
    expect(res.socialAccountIds).toEqual(['sa-1']);
  });

  it('returns none when brand has no connected accounts', async () => {
    dbState.preferences = { defaultPostSocialAccountIds: ['sa-1'] };
    dbState.accounts = [
      {
        id: 'sa-1',
        metadata: { disconnected: true },
        sortOrder: 0,
        createdAt: new Date('2025-01-01T00:00:00Z'),
      },
    ];

    const res = await resolvePostDestinationSocialAccountIds({ brandId: 'brand-1' });
    expect(res.source).toBe('none');
    expect(res.primarySocialAccountId).toBe(null);
    expect(res.socialAccountIds).toEqual([]);
  });
});
