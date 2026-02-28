import { PutObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prismaAssets } from '@postolio/database-assets';
import sharp from 'sharp';
import { calculateAspectRatio } from '../../utils/aspect-ratio.js';
import { assetsBucketName, getAssetUrl, s3Client } from '../../utils/s3.js';
import { fetchBufferFromUrl, guessExtension, nanoid, sanitizeFileName } from './shared.js';

interface ImportAssetBody {
  brandId: string;
  uploadedBy?: string;
  sourceUrl?: string;
  dataBase64?: string;
  fileName?: string;
  mimeType?: string;
  fileType?: 'image' | 'video';
  title?: string;
  altText?: string;
  description?: string;
  labelIds?: string[];
  collectionId?: string;
  publishedAt?: string;
}

interface ImportSourceData {
  buffer: Buffer;
  fileName?: string;
  mimeType?: string;
}

export function registerImportRoutes(fastify: FastifyInstance): void {
  fastify.post(
    '/assets/import',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => handleImportAsset(request, reply)
  );
}

async function handleImportAsset(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const body = request.body as ImportAssetBody;
  const validationError = validateImportBody(body);
  if (validationError) {
    return reply.code(400).send({ error: validationError });
  }

  try {
    const source = await loadImportSource(body);
    const mimeType = resolveMimeType(body.mimeType, source.mimeType);
    const fileName = resolveFileName(body.fileName, source.fileName, mimeType);
    const fileType = resolveFileType(body.fileType, mimeType);
    const s3Key = await uploadImportedBuffer(body.brandId, source.buffer, fileName, mimeType);

    const dimensions =
      fileType === 'image' ? await extractImageDimensions(source.buffer) : createEmptyDimensions();

    const collectionId = await resolveCollectionForBrand(body.brandId, body.collectionId, reply);
    if (collectionId === undefined) {
      return;
    }

    const asset = await prismaAssets.asset.create({
      data: {
        brandId: body.brandId,
        uploadedBy: body.uploadedBy || 'system',
        fileName,
        s3Key,
        s3Bucket: assetsBucketName,
        fileSize: source.buffer.byteLength,
        mimeType,
        fileType,
        ...dimensions,
        title: body.title,
        altText: body.altText,
        description: body.description,
        processingStatus: 'pending',
        collectionId: collectionId ?? undefined,
      },
    });

    await assignLabels(asset.id, body.labelIds, body.uploadedBy);
    const adjustedAsset = await applyPublishedAtOverride(asset.id, asset, body.publishedAt);

    return {
      asset: {
        ...adjustedAsset,
        labelIds: body.labelIds || [],
        url: getAssetUrl(adjustedAsset.s3Key),
      },
      message: 'Asset imported successfully',
    };
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({
      error: error instanceof Error ? error.message : 'Failed to import asset',
    });
  }
}

function validateImportBody(body: ImportAssetBody): string | null {
  if (!body.brandId) {
    return 'brandId is required';
  }

  if (!body.sourceUrl && !body.dataBase64) {
    return 'sourceUrl or dataBase64 is required';
  }

  if (body.dataBase64 && !body.mimeType) {
    return 'mimeType is required when sending base64 data';
  }

  return null;
}

async function loadImportSource(body: ImportAssetBody): Promise<ImportSourceData> {
  if (body.sourceUrl) {
    return fetchBufferFromUrl(body.sourceUrl);
  }

  const base64Source = body.dataBase64 || '';
  const base64Data = base64Source.startsWith('data:')
    ? base64Source.slice(base64Source.indexOf(',') + 1)
    : base64Source;

  return { buffer: Buffer.from(base64Data, 'base64') };
}

function resolveMimeType(
  explicitMime: string | undefined,
  fetchedMime: string | undefined
): string {
  const mimeType = explicitMime || fetchedMime;
  if (!mimeType) {
    throw new Error('Unable to determine MIME type for imported asset');
  }

  return mimeType;
}

function resolveFileName(
  explicitFileName: string | undefined,
  fetchedFileName: string | undefined,
  mimeType: string
): string {
  if (explicitFileName) {
    return explicitFileName;
  }

  if (fetchedFileName) {
    return fetchedFileName;
  }

  return `asset-${nanoid()}.${guessExtension(mimeType, 'bin')}`;
}

function resolveFileType(
  explicitType: ImportAssetBody['fileType'],
  mimeType: string
): 'image' | 'video' {
  if (explicitType) {
    return explicitType;
  }

  if (mimeType.startsWith('image/')) {
    return 'image';
  }

  if (mimeType.startsWith('video/')) {
    return 'video';
  }

  throw new Error('Unsupported MIME type for asset import');
}

async function uploadImportedBuffer(
  brandId: string,
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<string> {
  const timestamp = Date.now();
  const sanitized = sanitizeFileName(fileName);
  const s3Key = `brands/${brandId}/imports/${timestamp}_${nanoid()}_${sanitized}`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: assetsBucketName,
      Key: s3Key,
      Body: buffer,
      ContentType: mimeType,
    })
  );

  return s3Key;
}

async function extractImageDimensions(buffer: Buffer): Promise<{
  width?: number;
  height?: number;
  aspectRatio?: string;
  aspectRatioDecimal?: number;
  orientationType?: 'portrait' | 'landscape' | 'square';
}> {
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width ?? undefined;
  const height = metadata.height ?? undefined;

  if (!width || !height) {
    return createEmptyDimensions();
  }

  const ratio = calculateAspectRatio(width, height);
  return {
    width,
    height,
    aspectRatio: ratio.aspectRatio,
    aspectRatioDecimal: ratio.aspectRatioDecimal,
    orientationType: ratio.orientationType,
  };
}

function createEmptyDimensions(): {
  width?: number;
  height?: number;
  aspectRatio?: string;
  aspectRatioDecimal?: number;
  orientationType?: 'portrait' | 'landscape' | 'square';
} {
  return {
    width: undefined,
    height: undefined,
    aspectRatio: undefined,
    aspectRatioDecimal: undefined,
    orientationType: undefined,
  };
}

async function resolveCollectionForBrand(
  brandId: string,
  collectionId: string | undefined,
  reply: FastifyReply
): Promise<string | null | undefined> {
  if (!collectionId) {
    return null;
  }

  const collection = await prismaAssets.assetTaxonomyItem.findUnique({
    where: { id: collectionId },
    select: { id: true, brandId: true, type: true },
  });

  if (collection?.brandId !== brandId || collection?.type !== 'COLLECTION') {
    reply.code(400).send({ error: 'Invalid collection selection for brand' });
    return undefined;
  }

  return collection.id;
}

async function assignLabels(
  assetId: string,
  labelIds: string[] | undefined,
  uploadedBy: string | undefined
): Promise<void> {
  if (!labelIds || labelIds.length === 0) {
    return;
  }

  await prismaAssets.assetTaxonomyAssignment.createMany({
    data: labelIds.map((taxonomyItemId) => ({
      assetId,
      taxonomyItemId,
      createdBy: uploadedBy || 'system',
    })),
    skipDuplicates: true,
  });
}

async function applyPublishedAtOverride<T extends { id: string; updatedAt: Date }>(
  assetId: string,
  asset: T,
  publishedAt: string | undefined
): Promise<T> {
  if (!publishedAt) {
    return asset;
  }

  const publishedDate = new Date(publishedAt);
  if (Number.isNaN(publishedDate.getTime())) {
    return asset;
  }

  await prismaAssets.$executeRaw`
    UPDATE "assets"
    SET "updatedAt" = ${publishedDate}
    WHERE "id" = ${assetId}
  `;

  return {
    ...asset,
    updatedAt: publishedDate,
  };
}
