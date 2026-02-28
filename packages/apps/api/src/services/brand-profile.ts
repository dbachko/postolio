import { getDatabaseClient } from '../config/database.js';

// Simple in-memory cache to reduce DB load and improve resilience on transient errors
type Cached<T> = { value: T; expiresAt: number };
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const profileCache = new Map<string, Cached<BrandProfileContext | null>>();

const prisma = getDatabaseClient();
type TopicCount = { value: string; count: number };

type ProfileSummaryProjection = {
  text?: { tone?: string[] };
  visual?: { palette?: string[]; motifs?: string[]; composition?: string[] };
  topics?: TopicCount[];
} | null;

type StyleProfileData = {
  text?: { tone?: string[] };
  visual?: { palette?: string[]; motifs?: string[]; composition?: string[] };
  topics?: TopicCount[];
  archetype?: string;
} | null;

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

function buildMinimalProfileContext(
  brandId: string,
  overrides?: Partial<BrandProfileContext>
): BrandProfileContext {
  return {
    brandId,
    profileVersion: 0,
    tones: [],
    palette: [],
    topicsTop: null,
    createdAt: new Date().toISOString(),
    ...(overrides || {}),
  };
}

function getCachedProfile(brandId: string): BrandProfileContext | null | undefined {
  const cached = profileCache.get(brandId);
  if (!cached || cached.expiresAt <= Date.now()) {
    return undefined;
  }
  return cached.value;
}

function setCachedProfile(brandId: string, value: BrandProfileContext | null): void {
  profileCache.set(brandId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? (value as string[]) : undefined;
}

function asTopicsTop(value: unknown): TopicCount[] | null {
  return Array.isArray(value) ? (value as TopicCount[]) : null;
}

function mapProjectionRowToContext(row: any): BrandProfileContext {
  const summary = row.summaryProjection as unknown as ProfileSummaryProjection;
  return {
    brandId: row.brandId,
    profileVersion: row.profileVersion,
    promptSetVersion: row.promptSetVersion ?? undefined,
    archetype: (row.archetype as string | null) ?? undefined,
    tones: asStringArray(row.primaryTones),
    palette: asStringArray(row.primaryPalette),
    topicsTop: asTopicsTop(row.topicsTop),
    motifs: asOptionalStringArray(summary?.visual?.motifs),
    composition: asOptionalStringArray(summary?.visual?.composition),
    createdAt: row.createdAt.toISOString(),
  };
}

function mapStyleProfileToContext(params: {
  brandId: string;
  brandName?: string | null;
  styleProfile: StyleProfileData;
  createdAt?: Date;
}): BrandProfileContext {
  const styleProfile = params.styleProfile;
  return {
    brandId: params.brandId,
    brandName: params.brandName ?? undefined,
    profileVersion: 0,
    promptSetVersion: null,
    archetype: styleProfile?.archetype ?? null,
    tones: asStringArray(styleProfile?.text?.tone),
    palette: asStringArray(styleProfile?.visual?.palette),
    topicsTop: asTopicsTop(styleProfile?.topics),
    motifs: asOptionalStringArray(styleProfile?.visual?.motifs),
    composition: asOptionalStringArray(styleProfile?.visual?.composition),
    createdAt: (params.createdAt || new Date()).toISOString(),
  };
}

/**
 * Fetch the latest brand profile projection context for generation.
 * Falls back to minimal empty context if not found.
 */
export async function getBrandProfileContext(brandId: string): Promise<BrandProfileContext | null> {
  const cached = getCachedProfile(brandId);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const row = await prisma.brandStyleProfileProjection.findUnique({ where: { brandId } });
    const value = row
      ? mapProjectionRowToContext(row)
      : ((await deriveFromBrandStyleProfile(brandId)) ?? buildMinimalProfileContext(brandId));
    setCachedProfile(brandId, value);
    return value;
  } catch (error) {
    // Prisma known request errors could indicate missing table/column after deploys
    const code = (error as { code?: string }).code;
    console.warn('Brand profile projection fetch failed; using fallback', { brandId, code });
    const value =
      (await deriveFromBrandStyleProfile(brandId)) ?? buildMinimalProfileContext(brandId);
    setCachedProfile(brandId, value);
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
    if (!brand) {
      return null;
    }

    return mapStyleProfileToContext({
      brandId,
      brandName: brand.name,
      styleProfile: brand.styleProfile as unknown as StyleProfileData,
      createdAt: brand.createdAt || undefined,
    });
  } catch (e) {
    console.warn('Failed to derive brand profile from styleProfile JSON', {
      brandId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
