import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();

export type PostDestinationSource = 'explicit' | 'brand_defaults' | 'primary' | 'none';

export type ResolvedPostDestinations = {
  socialAccountIds: string[];
  primarySocialAccountId: string | null;
  source: PostDestinationSource;
};

function normalizePreferences(preferences: unknown): Record<string, unknown> {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return {};
  return preferences as Record<string, unknown>;
}

function normalizeSocialAccountIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of input) {
    if (typeof v !== 'string') continue;
    const id = v.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function isDisconnected(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  return Boolean((metadata as any).disconnected);
}

export async function resolvePostDestinationSocialAccountIds(params: {
  brandId: string;
  explicitSocialAccountIds?: unknown;
}): Promise<ResolvedPostDestinations> {
  const brandId = params.brandId;
  const [brand, accounts] = await Promise.all([
    prisma.brand.findUnique({
      where: { id: brandId },
      select: { preferences: true },
    }),
    prisma.socialAccount.findMany({
      where: { brandId },
      select: { id: true, metadata: true, sortOrder: true, createdAt: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: 250,
    }),
  ]);

  const connectedOrdered = accounts.filter((a) => !isDisconnected(a.metadata)).map((a) => a.id);
  const connectedSet = new Set(connectedOrdered);
  const primarySocialAccountId = connectedOrdered[0] ?? null;

  const preferences = normalizePreferences(brand?.preferences);
  const defaultIds = normalizeSocialAccountIds((preferences as any).defaultPostSocialAccountIds);
  const defaultAllowed = defaultIds.filter((id) => connectedSet.has(id));

  const explicitRequested =
    params.explicitSocialAccountIds === undefined
      ? null
      : normalizeSocialAccountIds(params.explicitSocialAccountIds);

  if (explicitRequested && explicitRequested.length > 0) {
    const explicitAllowed = explicitRequested.filter((id) => connectedSet.has(id));
    if (explicitAllowed.length > 0) {
      return { socialAccountIds: explicitAllowed, primarySocialAccountId, source: 'explicit' };
    }

    if (primarySocialAccountId) {
      return {
        socialAccountIds: [primarySocialAccountId],
        primarySocialAccountId,
        source: 'primary',
      };
    }

    return { socialAccountIds: [], primarySocialAccountId: null, source: 'none' };
  }

  if (defaultAllowed.length > 0) {
    return {
      socialAccountIds: defaultAllowed,
      primarySocialAccountId,
      source: 'brand_defaults',
    };
  }

  if (primarySocialAccountId) {
    return {
      socialAccountIds: [primarySocialAccountId],
      primarySocialAccountId,
      source: 'primary',
    };
  }

  return { socialAccountIds: [], primarySocialAccountId: null, source: 'none' };
}
