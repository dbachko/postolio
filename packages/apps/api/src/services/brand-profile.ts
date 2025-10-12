import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();

export interface BrandProfileContext {
  brandId: string;
  brandName?: string;
  profileVersion: number;
  promptSetVersion?: string | null;
  archetype?: string | null;
  tones: string[];
  palette: string[];
  topicsTop: Array<{ value: string; count: number }> | null;
  motifs?: string[];
  composition?: string[];
  createdAt: string;
}

/**
 * Fetch the latest brand profile projection context for generation.
 * Falls back to minimal empty context if not found.
 */
export async function getBrandProfileContext(brandId: string): Promise<BrandProfileContext | null> {
  const row = await prisma.brandStyleProfileProjection.findUnique({ where: { brandId } });
  if (!row) return null;

  // Try to extract motifs/composition from summaryProjection if present
  const summary = row.summaryProjection as unknown as {
    text?: { tone?: string[] };
    visual?: { palette?: string[]; motifs?: string[]; composition?: string[] };
    topics?: Array<{ value: string; count: number }>;
  } | null;

  const tones: string[] = Array.isArray(row.primaryTones) ? row.primaryTones : []; // db field
  const palette: string[] = Array.isArray(row.primaryPalette) ? row.primaryPalette : [];
  const topicsTop = row.topicsTop as unknown as Array<{ value: string; count: number }> | null;

  const motifs: string[] | undefined = Array.isArray(summary?.visual?.motifs)
    ? (summary!.visual!.motifs as string[])
    : undefined;
  const composition: string[] | undefined = Array.isArray(summary?.visual?.composition)
    ? (summary!.visual!.composition as string[])
    : undefined;

  return {
    brandId: row.brandId,
    profileVersion: row.profileVersion,
    promptSetVersion: row.promptSetVersion ?? undefined,
    archetype: (row.archetype as string | null) ?? undefined,
    tones,
    palette,
    topicsTop: topicsTop || null,
    motifs,
    composition,
    createdAt: row.createdAt.toISOString(),
  };
}
