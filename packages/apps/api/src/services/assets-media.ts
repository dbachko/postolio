import sharp from 'sharp';
import { logger as baseLogger } from '@postolio/logger';
import { AssetsServiceClient, type AssetRecord } from '@postolio/assets-client';
import { config } from '../config/env-validation.js';
import { getDatabaseClient } from '../config/database.js';
import type { PrismaClient, Prisma } from '@postolio/database';
import { formatError } from '../utils/logging.js';

export interface AssetUploadMetadata {
  contentId: string;
  brandId: string;
  campaignId?: string | null;
  uploadedBy?: string;
  source?: string;
  originalPrompt?: string;
  generatedAt?: Date;
  publishedAt?: Date;
  tags?: string[];
  hideFromLibrary?: boolean;
  folderId?: string | null;
}

export interface AttachAssetParams {
  contentId: string;
  asset: AssetRecord;
  usageContext?: string;
  prisma?: PrismaClient | Prisma.TransactionClient;
}

let cachedClient: AssetsServiceClient | null = null;

const assetsLogger = baseLogger.child({ module: 'assets-media' });

function getAssetsClient(): AssetsServiceClient {
  if (!cachedClient) {
    cachedClient = new AssetsServiceClient({
      baseUrl: config.ASSETS_API_BASE_URL,
      serviceToken: config.ASSETS_API_SERVICE_TOKEN,
    });
  }

  return cachedClient;
}

export async function importImageFromExternalUrl(
  imageUrl: string,
  metadata: AssetUploadMetadata
): Promise<AssetRecord> {
  // Offload download and storage to assets-api to avoid OOM in API service
  // This skips local optimization (resize/reformat), but saves significant memory per request
  const client = getAssetsClient();
  return client.importFromUrl({
    brandId: metadata.brandId,
    uploadedBy: metadata.uploadedBy || 'system',
    sourceUrl: imageUrl,
    fileName: deriveFileName(imageUrl, metadata.contentId),
    mimeType: 'image/jpeg', // Default hint; assets-api will detect actual
    fileType: 'image',
    title: metadata.originalPrompt,
    tags: deriveAssetTags(metadata),
    folderId: metadata.folderId || undefined,
    publishedAt: metadata.publishedAt?.toISOString(),
  });
}

export async function importImageBuffer(
  buffer: Buffer,
  metadata: AssetUploadMetadata
): Promise<AssetRecord> {
  const optimized = await optimizeImage(buffer);
  return uploadBufferToAssets(optimized, metadata, `${metadata.contentId}.jpg`);
}

export const HIDDEN_ASSET_TAG = '__hidden';
export const ANALYSIS_CACHE_TAG = '__analysis_cache';
export const AI_GENERATED_TAG = 'ai_generated';
export const INSTAGRAM_IMPORT_TAG = 'instagram_import';
export const ANALYSIS_FOLDER_NAME = 'Analysis Cache';

function deriveAssetTags(metadata: AssetUploadMetadata): string[] | undefined {
  const collected = new Set<string>();
  const normalizedSource = metadata.source?.toLowerCase();

  if (metadata.tags?.length) {
    metadata.tags.forEach((tag) => {
      if (tag) collected.add(tag);
    });
  }

  if (metadata.campaignId) {
    collected.add(`campaign:${metadata.campaignId}`);
  }

  if (normalizedSource) {
    collected.add(`source:${normalizedSource}`);
    if (normalizedSource.includes('analysis')) {
      collected.add(ANALYSIS_CACHE_TAG);
      collected.add(HIDDEN_ASSET_TAG);
    }
    if (
      normalizedSource.includes('midjourney') ||
      normalizedSource.includes('dalle') ||
      normalizedSource.includes('ai')
    ) {
      collected.add(AI_GENERATED_TAG);
    }
    if (normalizedSource.includes('instagram')) {
      collected.add(INSTAGRAM_IMPORT_TAG);
    }
  }

  if (metadata.hideFromLibrary) {
    collected.add(HIDDEN_ASSET_TAG);
  }

  if (collected.size === 0) {
    return undefined;
  }
  return Array.from(collected);
}

export async function verifyAssetOwnership(assetId: string, brandId: string): Promise<AssetRecord> {
  const client = getAssetsClient();
  const result = await client.verifyOwnership({ assetId, brandId });
  if (!result.valid || !result.asset) {
    throw new Error('Asset does not belong to this brand or could not be found');
  }
  return result.asset;
}

export async function attachAssetToContent(params: AttachAssetParams): Promise<void> {
  const prisma = params.prisma ?? getDatabaseClient();
  const usageContext = params.usageContext ?? 'primary';
  const asset = params.asset;

  await prisma.content.update({
    where: { id: params.contentId },
    data: {
      primaryAssetId: asset.id,
      primaryAssetCdnUrl: asset.url,
      primaryAssetWidth: asset.width ?? null,
      primaryAssetHeight: asset.height ?? null,
    },
  });
  await prisma.postMediaAsset.upsert({
    where: {
      contentId_usageContext: {
        contentId: params.contentId,
        usageContext,
      },
    },
    update: {
      assetId: asset.id,
      cdnUrl: asset.url,
      width: asset.width ?? null,
      height: asset.height ?? null,
      updatedAt: new Date(),
    },
    create: {
      contentId: params.contentId,
      usageContext,
      assetId: asset.id,
      cdnUrl: asset.url,
      width: asset.width ?? null,
      height: asset.height ?? null,
    },
  });
}

async function uploadBufferToAssets(
  buffer: Buffer,
  metadata: AssetUploadMetadata,
  fileName: string
): Promise<AssetRecord> {
  const client = getAssetsClient();
  const payloadBase64 = buffer.toString('base64');
  const tags = deriveAssetTags(metadata);

  return client.importFromBase64({
    brandId: metadata.brandId,
    uploadedBy: metadata.uploadedBy || 'system',
    dataBase64: payloadBase64,
    fileName,
    mimeType: 'image/jpeg',
    fileType: 'image',
    title: metadata.originalPrompt,
    tags,
    folderId: metadata.folderId || undefined,
    publishedAt: metadata.publishedAt?.toISOString(),
  });
}

async function optimizeImage(buffer: Buffer): Promise<Buffer> {
  try {
    const image = sharp(buffer);
    const metadata = await image.metadata();

    const processedImage = image.resize(1080, 1080, {
      fit: 'contain',
      position: 'center',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    });

    if (metadata.channels === 4 || metadata.hasAlpha) {
      processedImage.flatten({ background: { r: 255, g: 255, b: 255 } });
    }

    return processedImage.jpeg({ quality: 85, progressive: true }).toBuffer();
  } catch (error) {
    assetsLogger.error('Error optimizing image', formatError(error));
    return buffer;
  }
}

function deriveFileName(imageUrl: string, fallbackId: string): string {
  try {
    const url = new URL(imageUrl);
    const name = url.pathname.split('/').pop();
    if (!name) {
      return `${fallbackId}.jpg`;
    }
    if (/\.jpe?g$/i.test(name)) {
      return name;
    }
    return `${name}.jpg`;
  } catch {
    return `${fallbackId}.jpg`;
  }
}
