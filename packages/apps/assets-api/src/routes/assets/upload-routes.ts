import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  normalizeAssetLabelName,
  prismaAssets,
  type Prisma as AssetsPrisma,
} from '@postolio/database-assets';
import { assetsBucketName, generateUploadUrl } from '../../utils/s3.js';
import { mapAssetWithLabelsAndUrls } from './shared.js';

interface UploadUrlBody {
  brandId: string;
  fileName: string;
  contentType: string;
  fileType: 'image' | 'video';
  fileSize: number;
}

interface CreateAssetBody {
  brandId: string;
  fileName: string;
  s3Key: string;
  fileSize: number;
  mimeType: string;
  fileType: 'image' | 'video';
  uploadedBy?: string;
  width?: number;
  height?: number;
  duration?: number;
  title?: string;
  altText?: string;
  description?: string;
  collectionId?: string | null;
  labelIds?: string[];
}

export function registerUploadRoutes(fastify: FastifyInstance): void {
  fastify.post(
    '/assets/upload-url',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => handleUploadUrlRequest(request, reply)
  );

  fastify.post('/assets', { preHandler: [fastify.authenticateService] }, async (request, reply) =>
    handleCreateAssetRequest(request, reply)
  );
}

async function handleUploadUrlRequest(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<unknown> {
  const body = request.body as UploadUrlBody;

  try {
    if (!hasRequiredUploadFields(body)) {
      return reply.code(400).send({ error: 'Missing required fields' });
    }

    if (!isValidFileSize(body.fileSize)) {
      return reply.code(400).send({ error: 'Invalid file size' });
    }

    const uploadData = await generateUploadUrl(body);
    return {
      ...uploadData,
      message: 'Upload URL generated successfully',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate upload URL';
    const isBadRequest =
      error instanceof Error &&
      (message.toLowerCase().includes('invalid') || message.toLowerCase().includes('exceeds'));

    if (isBadRequest) {
      request.log.warn(error);
    } else {
      request.log.error(error);
    }

    return reply.code(isBadRequest ? 400 : 500).send({ error: message });
  }
}

function hasRequiredUploadFields(body: UploadUrlBody): boolean {
  return !!(
    body.brandId &&
    body.fileName &&
    body.contentType &&
    body.fileType &&
    body.fileSize != null
  );
}

function isValidFileSize(fileSize: unknown): boolean {
  return typeof fileSize === 'number' && !Number.isNaN(fileSize) && fileSize > 0;
}

async function handleCreateAssetRequest(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<unknown> {
  const body = request.body as CreateAssetBody;

  try {
    const resolvedCollectionId = await resolveCollectionId(body.brandId, body.collectionId, reply);
    if (resolvedCollectionId === undefined) {
      return;
    }

    const asset = await createAssetRecord(body, resolvedCollectionId);
    const labelIds = await createAssetLabels(asset.id, body.labelIds, body.uploadedBy);

    return {
      asset: {
        ...mapAssetWithLabelsAndUrls({ ...asset, labelAssignments: [] }),
        labelIds,
      },
      message: 'Asset created successfully',
    };
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({
      error: error instanceof Error ? error.message : 'Failed to create asset',
    });
  }
}

async function resolveCollectionId(
  brandId: string,
  collectionId: string | null | undefined,
  reply: FastifyReply
): Promise<string | null | undefined> {
  if (!collectionId) {
    return collectionId ?? undefined;
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

async function createAssetRecord(
  body: CreateAssetBody,
  collectionId: string | null | undefined
): Promise<AssetsPrisma.AssetGetPayload<Record<string, never>>> {
  return prismaAssets.asset.create({
    data: {
      brandId: body.brandId,
      uploadedBy: body.uploadedBy || 'system',
      fileName: body.fileName,
      s3Key: body.s3Key,
      s3Bucket: assetsBucketName,
      fileSize: body.fileSize,
      mimeType: body.mimeType,
      fileType: body.fileType,
      width: body.width,
      height: body.height,
      duration: body.duration,
      title: body.title,
      altText: body.altText,
      description: body.description,
      collectionId: collectionId ?? undefined,
      processingStatus: 'pending',
    },
  });
}

async function createAssetLabels(
  assetId: string,
  labelIds: string[] | undefined,
  uploadedBy: string | undefined
): Promise<string[]> {
  const normalizedLabelIds = labelIds && labelIds.length > 0 ? labelIds : [];
  if (normalizedLabelIds.length === 0) {
    return [];
  }

  await prismaAssets.assetTaxonomyAssignment.createMany({
    data: normalizedLabelIds.map((taxonomyItemId) => ({
      assetId,
      taxonomyItemId,
      createdBy: uploadedBy || 'system',
    })),
    skipDuplicates: true,
  });

  return normalizedLabelIds;
}

export async function ensureLabelsExist(
  brandId: string,
  labelNames: string[],
  createdBy: string
): Promise<string[]> {
  const normalized = labelNames
    .map((name) => name?.trim())
    .filter((name): name is string => !!name)
    .map((name) => ({ name, nameNorm: normalizeAssetLabelName(name) }));

  if (normalized.length === 0) {
    return [];
  }

  const norms = normalized.map((item) => item.nameNorm);
  const existing = await prismaAssets.assetTaxonomyItem.findMany({
    where: { brandId, type: 'LABEL', nameNorm: { in: norms }, deletedAt: null },
    select: { id: true, nameNorm: true },
  });

  const existingByNorm = new Map(existing.map((item) => [item.nameNorm, item.id]));
  const toCreate = normalized.filter((item) => !existingByNorm.has(item.nameNorm));

  if (toCreate.length > 0) {
    await prismaAssets.assetTaxonomyItem.createMany({
      data: toCreate.map((item) => ({
        brandId,
        type: 'LABEL',
        name: item.name,
        nameNorm: item.nameNorm,
        createdBy,
      })),
      skipDuplicates: true,
    });
  }

  const updated = await prismaAssets.assetTaxonomyItem.findMany({
    where: { brandId, type: 'LABEL', nameNorm: { in: norms }, deletedAt: null },
    select: { id: true },
  });

  return updated.map((item) => item.id);
}
