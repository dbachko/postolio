import { getDatabaseClient } from '../../../config/database.js';
import { assertBrandOwnership } from '../../../services/ownership.js';
import { getAssetsClient } from '../../../services/assets-media.js';
import { RecommendationEngine } from '../../../services/recommendations.js';

export const prisma: ReturnType<typeof getDatabaseClient> = getDatabaseClient();
export const recommendationEngine = new RecommendationEngine();

export function periodToDays(period: string | undefined): number {
  if (period === '7d') {
    return 7;
  }
  if (period === '90d') {
    return 90;
  }
  return 30;
}

export function windowToDays(window: string | undefined): number {
  if (window === '7d') {
    return 7;
  }
  if (window === '90d') {
    return 90;
  }
  return 30;
}

export async function resolveSocialAccountForUser(params: {
  userId: string;
  socialAccountId: string;
}) {
  const account = await prisma.socialAccount.findUnique({
    where: { id: params.socialAccountId },
    select: {
      id: true,
      brandId: true,
      platform: true,
      externalAccountId: true,
      externalPageId: true,
      username: true,
      displayName: true,
      metadata: true,
      brand: { select: { userId: true } },
    },
  });

  if (account?.brand.userId !== params.userId) {
    throw Object.assign(new Error('social_account_not_found'), { statusCode: 404 });
  }

  await assertBrandOwnership(params.userId, account.brandId);
  const metadata = (account.metadata || {}) as Record<string, unknown>;
  const profileData =
    metadata.profileData &&
    typeof metadata.profileData === 'object' &&
    !Array.isArray(metadata.profileData)
      ? (metadata.profileData as Record<string, unknown>)
      : null;
  const directUrl = metadata.profile_picture_url;
  const nestedUrl = profileData?.profile_picture_url;
  const profilePictureUrl =
    typeof directUrl === 'string' && directUrl
      ? directUrl
      : typeof nestedUrl === 'string' && nestedUrl
        ? nestedUrl
        : null;

  return {
    id: account.id,
    brandId: account.brandId,
    platform: String(account.platform),
    externalAccountId: account.externalAccountId,
    externalPageId: account.externalPageId ?? null,
    username: account.username ?? null,
    displayName: account.displayName ?? null,
    profilePictureUrl,
  };
}

export function computeEngagementRate(
  totalEngagement: number,
  totalImpressions: number,
  totalReach: number
) {
  const denom = totalImpressions > 0 ? totalImpressions : totalReach > 0 ? totalReach : 0;
  return denom > 0 ? (totalEngagement / denom) * 100 : 0;
}

export async function loadAssetsById(assetIds: string[]) {
  const uniquePrimaryAssetIds = Array.from(new Set(assetIds.filter(Boolean)));
  const assetsById = new Map<string, any>();
  if (uniquePrimaryAssetIds.length === 0) {
    return assetsById;
  }

  try {
    const assetsClient = getAssetsClient();
    const assets = await assetsClient.getBatchAssets(uniquePrimaryAssetIds);
    assets.forEach((asset) => {
      if (asset?.id) {
        assetsById.set(asset.id, asset);
      }
    });
  } catch {
    // Ignore thumbnail loading failures for analytics endpoints.
  }

  return assetsById;
}

export function resolveThumbnail(asset: any) {
  const thumbnailCandidate = asset?.thumbnailUrl;
  if (typeof thumbnailCandidate === 'string' && thumbnailCandidate.length > 0) {
    return thumbnailCandidate;
  }
  if (asset?.fileType === 'image' && typeof asset?.url === 'string') {
    return asset.url;
  }
  return null;
}
