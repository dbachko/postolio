import { AssetsServiceClient, type AssetRecord } from '@postolio/assets-client';

import { getDatabaseClient } from '../../config/database.js';
import { config } from '../../config/env-validation.js';
import { assertBrandOwnership } from '../../services/ownership.js';

export const assetsClient = new AssetsServiceClient({
  baseUrl: config.ASSETS_API_BASE_URL,
  serviceToken: config.ASSETS_API_SERVICE_TOKEN,
});

export const prisma: ReturnType<typeof getDatabaseClient> = getDatabaseClient();

export async function ensureBrandOwned(
  brandId: string,
  userId: string
): Promise<{ owns: boolean }> {
  try {
    await assertBrandOwnership(userId, brandId);
    return { owns: true };
  } catch {
    return { owns: false };
  }
}

export async function ensureAssetOwned(
  assetId: string,
  userId: string
): Promise<AssetRecord | null> {
  const asset = await assetsClient.getAsset(assetId);
  const { owns } = await ensureBrandOwned(asset.brandId, userId);
  return owns ? asset : null;
}
