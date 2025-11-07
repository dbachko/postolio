import sharp from 'sharp';
import { logger as baseLogger } from '@postolio/logger';
import { AssetsServiceClient, type AssetRecord } from '@postolio/assets-client';
import { config } from '../config/env-validation.js';
import { getDatabaseClient } from '../config/database.js';
import type { PrismaClient, Prisma } from '@postolio/database';
import dns from 'node:dns/promises';
import { isIP } from 'node:net';
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

const PRIVATE_HOSTNAMES = new Set(['localhost', '127.0.0.1']);
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
  const buffer = await downloadImage(imageUrl);
  const optimized = await optimizeImage(buffer);
  return uploadBufferToAssets(optimized, metadata, deriveFileName(imageUrl, metadata.contentId));
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

const MAX_REMOTE_IMAGE_BYTES = 50 * 1024 * 1024; // 50MB ceiling matching legacy behavior

async function ensurePublicHost(hostname: string): Promise<void> {
  const lowerHost = hostname.toLowerCase();
  if (PRIVATE_HOSTNAMES.has(lowerHost) || lowerHost.endsWith('.local')) {
    throw new Error('Blocked host for remote fetch');
  }

  const directIp = isIP(hostname);
  if (directIp) {
    if (isPrivateIp(hostname)) {
      throw new Error('Blocked private IP address');
    }
    return;
  }

  try {
    const lookup = await dns.lookup(hostname, { all: true });
    if (lookup.some((entry) => isPrivateIp(entry.address))) {
      throw new Error('Blocked private DNS resolution');
    }
  } catch (error) {
    // If DNS fails we err on the side of caution and block to avoid SSRF surprises
    const reason = error instanceof Error ? error.message : 'unknown DNS failure';
    throw new Error(`Unable to resolve remote host: ${reason}`);
  }
}

function isPrivateIp(ip: string): boolean {
  if (ip === '0.0.0.0') return true;
  if (ip.startsWith('127.')) return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('169.254.')) return true;

  if (ip.startsWith('172.')) {
    const secondOctet = Number(ip.split('.')[1]);
    if (secondOctet >= 16 && secondOctet <= 31) {
      return true;
    }
  }

  if (ip === '::1' || ip === '::') return true;
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // unique local IPv6
  return false;
}

async function downloadImage(url: string): Promise<Buffer> {
  try {
    const urlObj = new URL(url);
    if (!['https:', 'http:'].includes(urlObj.protocol)) {
      throw new Error(`Unsupported protocol: ${urlObj.protocol}`);
    }

    await ensurePublicHost(urlObj.hostname);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Postolio-AssetFetcher/1.0',
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
      }

      const contentLengthHeader = response.headers.get('content-length');
      if (
        contentLengthHeader &&
        Number.isFinite(Number(contentLengthHeader)) &&
        Number(contentLengthHeader) > MAX_REMOTE_IMAGE_BYTES
      ) {
        throw new Error('Remote file too large');
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.startsWith('image/')) {
        throw new Error('URL does not point to an image');
      }

      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_REMOTE_IMAGE_BYTES) {
        throw new Error('Downloaded image exceeds size limit');
      }
      return Buffer.from(arrayBuffer);
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Unknown error downloading image');
  }
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
