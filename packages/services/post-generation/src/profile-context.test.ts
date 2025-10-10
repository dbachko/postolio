import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchProfileContext } from './profile-context';

vi.mock('./db', () => {
  type FakeProjection = {
    brandId: string;
    profileVersion: number;
    promptSetVersion?: string | null;
    archetype?: string | null;
    primaryTones?: string[];
    primaryPalette?: string[];
    topicsTop?: unknown;
    createdAt: Date;
  };
  const rows: Record<string, FakeProjection> = {};
  return {
    getPrisma: () => ({
      brandStyleProfileProjection: {
        findUnique: async ({ where: { brandId } }: { where: { brandId: string } }) =>
          rows[brandId] || null,
      },
    }),
    __helpers: {
      clear: () => {
        Object.keys(rows).forEach((k) => delete rows[k]);
      },
      set: (brandId: string, row: FakeProjection) => {
        rows[brandId] = row;
      },
    },
  };
});

describe('fetchProfileContext', () => {
  beforeEach(async () => {
    const { __helpers } = await import('./db');
    __helpers.clear();
  });

  it('throws when no projection exists', async () => {
    await expect(fetchProfileContext('brand-x')).rejects.toThrow(/No profile projection/);
  });

  it('returns shaped context when projection exists', async () => {
    const { __helpers } = await import('./db');
    __helpers.set('brand-1', {
      brandId: 'brand-1',
      profileVersion: 3,
      promptSetVersion: 'v1',
      archetype: 'Explorer',
      primaryTones: ['bold', 'friendly'],
      primaryPalette: ['#223344', '#aabbcc'],
      topicsTop: [{ value: 'travel', count: 4 }],
      createdAt: new Date('2025-10-10T00:00:00Z'),
    });
    const ctx = await fetchProfileContext('brand-1');
    expect(ctx.brandId).toBe('brand-1');
    expect(ctx.profileVersion).toBe(3);
    expect(ctx.tones).toContain('bold');
    expect(ctx.palette[0]).toBe('#223344');
    expect(ctx.createdAt).toBe('2025-10-10T00:00:00.000Z');
  });
});
