import { AssetsServiceClient } from '@postolio/assets-client';
import { logger } from '@postolio/logger';
import { config } from '../config/env-validation.js';
import type { ContentType as ValidationContentType } from '@postolio/content-validation';

export type AssetMetadataInfo = {
  fileType: 'image' | 'video';
  s3Key: string;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
};

export type StructuredMediaAsset = {
  key: string;
  type: 'image' | 'video';
  order: number;
  width?: number;
  height?: number;
  assetId?: string;
  duration?: number;
};

const ASSET_TYPE_CACHE_TTL_MS = 10 * 60 * 1000;
const ASSET_TYPE_CACHE_MAX_ENTRIES = 2000;

let cachedAssetsClient: AssetsServiceClient | null = null;
const assetTypeCache = new Map<string, { info: AssetMetadataInfo; expiresAt: number }>();

function getAssetsServiceClient(): AssetsServiceClient {
  if (!cachedAssetsClient) {
    cachedAssetsClient = new AssetsServiceClient({
      baseUrl: config.ASSETS_API_BASE_URL,
      serviceToken: config.ASSETS_API_SERVICE_TOKEN,
    });
  }
  return cachedAssetsClient;
}

function getCachedAssetType(assetId: string, now: number): AssetMetadataInfo | null {
  const entry = assetTypeCache.get(assetId);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= now) {
    assetTypeCache.delete(assetId);
    return null;
  }
  return entry.info;
}

function pruneAssetTypeCache(now: number) {
  for (const [assetId, entry] of assetTypeCache.entries()) {
    if (entry.expiresAt <= now) {
      assetTypeCache.delete(assetId);
    }
  }
  while (assetTypeCache.size > ASSET_TYPE_CACHE_MAX_ENTRIES) {
    const oldestKey = assetTypeCache.keys().next().value as string | undefined;
    if (!oldestKey) {
      break;
    }
    assetTypeCache.delete(oldestKey);
  }
}

function setCachedAssetType(assetId: string, info: AssetMetadataInfo, now: number) {
  pruneAssetTypeCache(now);
  assetTypeCache.set(assetId, { info, expiresAt: now + ASSET_TYPE_CACHE_TTL_MS });
}

export async function getAssetMetadataByIds(
  assetIds: string[]
): Promise<Map<string, AssetMetadataInfo>> {
  const uniqueIds = Array.from(new Set(assetIds.filter(Boolean)));
  const result = new Map<string, AssetMetadataInfo>();
  const idsToFetch: string[] = [];
  const now = Date.now();

  for (const assetId of uniqueIds) {
    const cached = getCachedAssetType(assetId, now);
    if (cached) {
      result.set(assetId, cached);
      continue;
    }
    idsToFetch.push(assetId);
  }

  if (idsToFetch.length === 0) {
    return result;
  }

  try {
    const assetsClient = getAssetsServiceClient();
    const fetched = await assetsClient.getBatchAssets(idsToFetch);
    fetched.forEach((asset, idx) => {
      const assetId = idsToFetch[idx];
      if (!asset) {
        return;
      }
      const info: AssetMetadataInfo = {
        fileType: asset.fileType === 'video' ? 'video' : 'image',
        s3Key: asset.s3Key,
        width: asset.width ?? null,
        height: asset.height ?? null,
        duration: asset.duration ?? null,
      };
      result.set(assetId, info);
      setCachedAssetType(assetId, info, now);
    });
  } catch (error) {
    logger.warn('Failed to fetch asset type metadata from assets service', {
      error,
      assetCount: idsToFetch.length,
    });
  }

  return result;
}

export async function resolveStructuredMediaAssets(
  dbMediaAssets: Array<{ assetId: string; displayOrder: number | null }>
): Promise<{ missingAssetIds: string[]; structuredMediaAssets: StructuredMediaAsset[] }> {
  const assetIds = dbMediaAssets
    .map((asset) => asset.assetId)
    .filter((assetId): assetId is string => typeof assetId === 'string' && assetId.length > 0);
  const assetMetadataById = await getAssetMetadataByIds(assetIds);
  const missingAssetIds: string[] = [];
  const structuredMediaAssets: StructuredMediaAsset[] = [];

  for (const asset of dbMediaAssets) {
    const info = assetMetadataById.get(asset.assetId);
    if (!info) {
      missingAssetIds.push(asset.assetId);
      continue;
    }
    structuredMediaAssets.push({
      key: info.s3Key,
      type: info.fileType,
      order: asset.displayOrder ?? 0,
      width: info.width ?? undefined,
      height: info.height ?? undefined,
      assetId: asset.assetId,
      duration: info.fileType === 'video' ? (info.duration ?? undefined) : undefined,
    });
  }

  structuredMediaAssets.sort((a, b) => a.order - b.order);
  return { missingAssetIds, structuredMediaAssets };
}

export function isDisconnected(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') {
    return false;
  }
  return Boolean((metadata as any).disconnected);
}

export function deriveScheduleMediaType(
  contentType: string,
  mediaAssets: Array<{ type: 'image' | 'video' }>
): 'image' | 'video' {
  const normalizedContentType = (contentType || '').toLowerCase();
  if (normalizedContentType === 'reel') {
    return 'video';
  }
  if (mediaAssets.length === 1 && mediaAssets[0]?.type === 'video') {
    return 'video';
  }
  return 'image';
}

export function normalizeContentType(value: unknown): ValidationContentType {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'post' || normalized === 'reel' || normalized === 'story') {
    return normalized;
  }
  return 'post';
}
