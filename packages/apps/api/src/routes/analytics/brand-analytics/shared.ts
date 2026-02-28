import { getDatabaseClient } from '../../../config/database.js';
import { assertBrandOwnership } from '../../../services/ownership.js';
import { getAssetsClient } from '../../../services/assets-media.js';

export const prisma: ReturnType<typeof getDatabaseClient> = getDatabaseClient();

export async function assertBrandOwnershipIfAuthenticated(request: any, brandId: string) {
  const userId = (request.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return;
  }
  await assertBrandOwnership(userId, brandId);
}

export function parseWindowDays(window: '7d' | '30d' | '90d' = '30d') {
  if (window === '7d') {
    return 7;
  }
  if (window === '90d') {
    return 90;
  }
  return 30;
}

export async function loadAssetMapByIds(params: {
  assetIds: string[];
  logger: { warn: (meta: unknown, message: string) => void };
  brandId: string;
}) {
  const uniqueAssetIds = Array.from(new Set(params.assetIds.filter(Boolean)));
  const assetsById = new Map<string, any>();
  if (uniqueAssetIds.length === 0) {
    return assetsById;
  }

  try {
    const assetsClient = getAssetsClient();
    const assets = await assetsClient.getBatchAssets(uniqueAssetIds);
    assets.forEach((asset) => {
      if (asset?.id) {
        assetsById.set(asset.id, asset);
      }
    });
  } catch (error) {
    params.logger.warn(
      { err: error, brandId: params.brandId },
      'Failed to fetch asset thumbnails for analytics'
    );
  }

  return assetsById;
}

export function resolveAssetThumbnail(asset: any) {
  const thumbnailCandidate = asset?.thumbnailUrl;
  if (typeof thumbnailCandidate === 'string' && thumbnailCandidate.length > 0) {
    return thumbnailCandidate;
  }
  if (asset?.fileType === 'image' && typeof asset?.url === 'string') {
    return asset.url;
  }
  return undefined;
}
