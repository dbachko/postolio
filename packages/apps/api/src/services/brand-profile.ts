import { getDatabaseClient } from '../config/database.js';

// Simple in-memory cache to reduce DB load and improve resilience on transient errors
type Cached<T> = { value: T; expiresAt: number };
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const profileCache = new Map<string, Cached<BrandProfileContext | null>>();

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
  // Cache hit
  const cached = profileCache.get(brandId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  // Helper: minimal fallback context
  const buildMinimal = (overrides?: Partial<BrandProfileContext>): BrandProfileContext => ({
    brandId,
    profileVersion: 0,
    tones: [],
    palette: [],
    topicsTop: null,
    createdAt: new Date().toISOString(),
    ...(overrides || {}),
  });

  try {
    const row = await prisma.brandStyleProfileProjection.findUnique({ where: { brandId } });
    if (!row) {
      // Fallback to brand.styleProfile if projection missing
      const derived = await deriveFromBrandStyleProfile(brandId);
      const value = derived || buildMinimal();
      profileCache.set(brandId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      return value;
    }

    // Try to extract motifs/composition from summaryProjection if present
    const summary = row.summaryProjection as unknown as {
      text?: { tone?: string[] };
      visual?: { palette?: string[]; motifs?: string[]; composition?: string[] };
      topics?: Array<{ value: string; count: number }>;
    } | null;

    const tones: string[] = Array.isArray(row.primaryTones) ? row.primaryTones : [];
    const palette: string[] = Array.isArray(row.primaryPalette) ? row.primaryPalette : [];
    const topicsTop = (row.topicsTop as unknown as Array<{ value: string; count: number }>) || null;
    const motifs: string[] | undefined = Array.isArray(summary?.visual?.motifs)
      ? (summary!.visual!.motifs as string[])
      : undefined;
    const composition: string[] | undefined = Array.isArray(summary?.visual?.composition)
      ? (summary!.visual!.composition as string[])
      : undefined;

    const value: BrandProfileContext = {
      brandId: row.brandId,
      profileVersion: row.profileVersion,
      promptSetVersion: row.promptSetVersion ?? undefined,
      archetype: (row.archetype as string | null) ?? undefined,
      tones,
      palette,
      topicsTop,
      motifs,
      composition,
      createdAt: row.createdAt.toISOString(),
    };

    profileCache.set(brandId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (error) {
    // Prisma known request errors could indicate missing table/column after deploys
    const code = (error as { code?: string }).code;
    console.warn('Brand profile projection fetch failed; using fallback', { brandId, code });
    const derived = await deriveFromBrandStyleProfile(brandId);
    const value = derived || buildMinimal();
    profileCache.set(brandId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }
}

/**
 * Attempt to derive a minimal profile context from Brand.styleProfile JSON if available.
 * Never throws; returns null if nothing usable can be derived.
 */
async function deriveFromBrandStyleProfile(brandId: string): Promise<BrandProfileContext | null> {
  try {
    const brand = await prisma.brand.findUnique({
      where: { id: brandId },
      select: { name: true, styleProfile: true, createdAt: true },
    });
    if (!brand) return null;

    const sp = brand.styleProfile as unknown as {
      text?: { tone?: string[] };
      visual?: { palette?: string[]; motifs?: string[]; composition?: string[] };
      topics?: Array<{ value: string; count: number }>;
      archetype?: string;
    } | null;

    const tones = Array.isArray(sp?.text?.tone) ? (sp!.text!.tone as string[]) : [];
    const palette = Array.isArray(sp?.visual?.palette) ? (sp!.visual!.palette as string[]) : [];
    const motifs = Array.isArray(sp?.visual?.motifs) ? (sp!.visual!.motifs as string[]) : undefined;
    const composition = Array.isArray(sp?.visual?.composition)
      ? (sp!.visual!.composition as string[])
      : undefined;
    const topicsTop = Array.isArray(sp?.topics)
      ? (sp!.topics as Array<{ value: string; count: number }>)
      : null;

    return {
      brandId,
      brandName: brand.name ?? undefined,
      profileVersion: 0,
      promptSetVersion: null,
      archetype: sp?.archetype ?? null,
      tones,
      palette,
      topicsTop,
      motifs,
      composition,
      createdAt: (brand.createdAt || new Date()).toISOString(),
    };
  } catch (e) {
    console.warn('Failed to derive brand profile from styleProfile JSON', {
      brandId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
