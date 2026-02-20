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
  uploadedBy?: string;
  source?: string;
  originalPrompt?: string;
  generatedAt?: Date;
  publishedAt?: Date;
  labelIds?: string[];
  collectionId?: string | null;
}

export interface AttachAssetParams {
  contentId: string;
  asset: AssetRecord;
  displayOrder?: number;
  prisma?: PrismaClient | Prisma.TransactionClient;
}

let cachedClient: AssetsServiceClient | null = null;

const assetsLogger = baseLogger.child({ module: 'assets-media' });

export function getAssetsClient(): AssetsServiceClient {
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
    fileName: deriveFileName(imageUrl, metadata.contentId, 'jpg'),
    mimeType: 'image/jpeg', // Default hint; assets-api will detect actual
    fileType: 'image',
    title: metadata.originalPrompt,
    labelIds: metadata.labelIds,
    collectionId: metadata.collectionId || undefined,
    publishedAt: metadata.publishedAt?.toISOString(),
  });
}

export async function importVideoFromExternalUrl(
  videoUrl: string,
  metadata: AssetUploadMetadata
): Promise<AssetRecord> {
  const client = getAssetsClient();
  return client.importFromUrl({
    brandId: metadata.brandId,
    uploadedBy: metadata.uploadedBy || 'system',
    sourceUrl: videoUrl,
    fileName: deriveFileName(videoUrl, metadata.contentId, 'mp4'),
    mimeType: 'video/mp4',
    fileType: 'video',
    title: metadata.originalPrompt,
    labelIds: metadata.labelIds,
    collectionId: metadata.collectionId || undefined,
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

export const ANALYSIS_COLLECTION_NAME = 'Analysis Cache';

export async function verifyAssetOwnership(assetId: string, brandId: string): Promise<AssetRecord> {
  const client = getAssetsClient();
  const result = await client.verifyOwnership({ assetId, brandId });
  if (!result.valid || !result.asset) {
    throw new Error('Asset does not belong to this brand or could not be found');
  }
  return result.asset;
}

export async function resolveGeneratedImageAsset(
  imageUrl: string,
  imageMetadata:
    | {
        source: string;
        originalPrompt: string;
        assetId?: string;
      }
    | undefined,
  metadata: AssetUploadMetadata
): Promise<AssetRecord> {
  if (imageMetadata?.assetId) {
    return verifyAssetOwnership(imageMetadata.assetId, metadata.brandId);
  }

  const mergedMetadata: AssetUploadMetadata = {
    ...metadata,
    ...(imageMetadata?.source && !metadata.source ? { source: imageMetadata.source } : {}),
    ...(imageMetadata?.originalPrompt && !metadata.originalPrompt
      ? { originalPrompt: imageMetadata.originalPrompt }
      : {}),
  };

  return importImageFromExternalUrl(imageUrl, mergedMetadata);
}

export async function attachAssetToContent(params: AttachAssetParams): Promise<void> {
  const prisma = params.prisma ?? getDatabaseClient();
  const asset = params.asset;
  const displayOrder = params.displayOrder ?? 0;

  await prisma.contentMediaAsset.upsert({
    where: {
      contentId_displayOrder: {
        contentId: params.contentId,
        displayOrder,
      },
    },
    update: {
      assetId: asset.id,
      updatedAt: new Date(),
    },
    create: {
      contentId: params.contentId,
      displayOrder,
      assetId: asset.id,
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

  return client.importFromBase64({
    brandId: metadata.brandId,
    uploadedBy: metadata.uploadedBy || 'system',
    dataBase64: payloadBase64,
    fileName,
    mimeType: 'image/jpeg',
    fileType: 'image',
    title: metadata.originalPrompt,
    labelIds: metadata.labelIds,
    collectionId: metadata.collectionId || undefined,
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

function deriveFileName(sourceUrl: string, fallbackId: string, fallbackExt: string): string {
  try {
    const url = new URL(sourceUrl);
    const name = url.pathname.split('/').pop();
    if (!name) {
      return `${fallbackId}.${fallbackExt}`;
    }
    if (/\.[a-z0-9]{2,5}$/i.test(name)) {
      return name;
    }
    return `${name}.${fallbackExt}`;
  } catch {
    return `${fallbackId}.${fallbackExt}`;
  }
}
