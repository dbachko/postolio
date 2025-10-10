import type { BrandStyleProfileProjection } from '@postolio/database';
import { getPrisma } from './db';

export interface GenerationProfileContext {
  brandId: string;
  profileVersion: number;
  promptSetVersion?: string | null;
  archetype?: string | null;
  tones: string[];
  palette: string[];
  topicsTop: unknown | null;
  createdAt: string;
}

export async function fetchProfileContext(brandId: string): Promise<GenerationProfileContext> {
  const prisma = getPrisma();
  const row: BrandStyleProfileProjection | null =
    await prisma.brandStyleProfileProjection.findUnique({
      where: { brandId },
    });
  if (!row) {
    throw new Error(
      'No profile projection available; generation blocked until first analysis completes'
    );
  }
  return {
    brandId: row.brandId,
    profileVersion: row.profileVersion,
    promptSetVersion: row.promptSetVersion ?? undefined,
    archetype: row.archetype ?? undefined,
    tones: row.primaryTones ?? [],
    palette: row.primaryPalette ?? [],
    topicsTop: row.topicsTop ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
