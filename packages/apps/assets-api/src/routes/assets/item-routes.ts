import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prismaAssets } from '@postolio/database-assets';
import { deleteS3Objects } from '../../utils/s3.js';
import { mapAssetWithLabelsAndUrls, mapAssetWithUrls } from './shared.js';

interface UpdateAssetBody {
  title?: string;
  altText?: string;
  description?: string;
  collectionId?: string | null;
  labelIds?: string[];
}

export function registerItemRoutes(fastify: FastifyInstance): void {
  fastify.get(
    '/assets/:id',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => handleGetAsset(request, reply)
  );

  fastify.post(
    '/assets/batch',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => handleBatchAssets(request, reply)
  );

  fastify.patch(
    '/assets/:id',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => handleUpdateAsset(request, reply)
  );

  fastify.delete(
    '/assets/:id',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => handleDeleteAsset(request, reply)
  );

  fastify.get(
    '/assets/:id/ownership',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => handleVerifyOwnership(request, reply)
  );
}

async function handleGetAsset(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const { id } = request.params as { id: string };

  try {
    const asset = await prismaAssets.asset.findUnique({
      where: { id },
      include: { labelAssignments: { select: { taxonomyItemId: true } } },
    });

    if (!asset) {
      return reply.code(404).send({ error: 'Asset not found' });
    }

    return { asset: mapAssetWithLabelsAndUrls(asset) };
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({
      error: error instanceof Error ? error.message : 'Failed to fetch asset',
    });
  }
}

async function handleBatchAssets(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const body = request.body as { assetIds: string[] };

  try {
    if (!body.assetIds || !Array.isArray(body.assetIds)) {
      return reply.code(400).send({ error: 'assetIds must be an array' });
    }

    if (body.assetIds.length === 0) {
      return { assets: [] };
    }

    if (body.assetIds.length > 50) {
      return reply.code(400).send({ error: 'Maximum 50 assets per batch request' });
    }

    const assets = await prismaAssets.asset.findMany({
      where: { id: { in: body.assetIds }, archivedAt: null },
      include: { labelAssignments: { select: { taxonomyItemId: true } } },
    });

    const assetMap = new Map(assets.map((asset) => [asset.id, mapAssetWithLabelsAndUrls(asset)]));
    return { assets: body.assetIds.map((id) => assetMap.get(id) || null) };
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({
      error: error instanceof Error ? error.message : 'Failed to fetch assets',
    });
  }
}

async function handleUpdateAsset(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const { id } = request.params as { id: string };
  const body = request.body as UpdateAssetBody;

  try {
    const resolvedCollectionId = await resolveCollectionId(body.collectionId, reply);
    if (resolvedCollectionId === undefined) {
      return;
    }

    const asset = await prismaAssets.asset.update({
      where: { id },
      data: {
        title: body.title,
        altText: body.altText,
        description: body.description,
        collectionId: resolvedCollectionId,
      },
    });

    const labelIds = await replaceAssetLabels(id, body.labelIds);
    return {
      asset: {
        ...mapAssetWithUrls(asset),
        labelIds,
      },
      message: 'Asset updated successfully',
    };
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({
      error: error instanceof Error ? error.message : 'Failed to update asset',
    });
  }
}

async function resolveCollectionId(
  collectionId: string | null | undefined,
  reply: FastifyReply
): Promise<string | null | undefined> {
  if (!collectionId) {
    return collectionId ?? undefined;
  }

  const collection = await prismaAssets.assetTaxonomyItem.findUnique({
    where: { id: collectionId },
    select: { id: true, type: true },
  });

  if (collection?.type !== 'COLLECTION') {
    reply.code(400).send({ error: 'Invalid collection selection' });
    return undefined;
  }

  return collection.id;
}

async function replaceAssetLabels(
  assetId: string,
  labelIds: string[] | undefined
): Promise<string[]> {
  if (!labelIds) {
    const existing = await prismaAssets.assetTaxonomyAssignment.findMany({
      where: { assetId },
      select: { taxonomyItemId: true },
    });

    return existing.map((assignment) => assignment.taxonomyItemId);
  }

  await prismaAssets.$transaction([
    prismaAssets.assetTaxonomyAssignment.deleteMany({ where: { assetId } }),
    ...(labelIds.length > 0
      ? [
          prismaAssets.assetTaxonomyAssignment.createMany({
            data: labelIds.map((taxonomyItemId) => ({
              assetId,
              taxonomyItemId,
              createdBy: 'system',
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);

  return labelIds;
}

async function handleDeleteAsset(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const { id } = request.params as { id: string };

  try {
    const asset = await prismaAssets.asset.findUnique({
      where: { id },
      select: {
        id: true,
        s3Key: true,
        thumbnailKey: true,
        thumbnailSmallKey: true,
        thumbnailLargeKey: true,
      },
    });

    if (!asset) {
      return reply.code(404).send({ error: 'Asset not found' });
    }

    const storageKeys = [
      asset.s3Key,
      asset.thumbnailKey,
      asset.thumbnailSmallKey,
      asset.thumbnailLargeKey,
    ].filter((key): key is string => !!key);

    await deleteS3Objects(storageKeys);
    await prismaAssets.asset.delete({ where: { id: asset.id } });
    return { success: true, message: 'Asset deleted permanently' };
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({
      error: error instanceof Error ? error.message : 'Failed to delete asset',
    });
  }
}

async function handleVerifyOwnership(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<unknown> {
  const { id } = request.params as { id: string };
  const query = request.query as { brandId?: string };

  if (!query.brandId) {
    return reply.code(400).send({ error: 'brandId query parameter is required' });
  }

  try {
    const asset = await prismaAssets.asset.findUnique({ where: { id } });
    if (!asset) {
      return reply.code(404).send({ error: 'Asset not found' });
    }

    const ownsAsset = asset.brandId === query.brandId;
    return {
      valid: ownsAsset,
      asset: ownsAsset ? mapAssetWithUrls(asset) : null,
    };
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({
      error: error instanceof Error ? error.message : 'Failed to verify asset ownership',
    });
  }
}
