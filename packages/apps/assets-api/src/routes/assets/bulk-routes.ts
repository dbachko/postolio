import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prismaAssets, type Prisma as AssetsPrisma } from '@postolio/database-assets';
import { deleteS3Objects } from '../../utils/s3.js';
import { ensureLabelsExist } from './upload-routes.js';

interface BulkActionBody {
  assetIds: string[];
  brandId?: string;
  action:
    | { move_to_collection: { collectionId?: string | null } }
    | { add_labels: { labelIds?: string[]; labelNames?: string[]; createdBy?: string } }
    | { remove_labels: { labelIds: string[] } }
    | { delete: Record<string, never> };
}

export function registerBulkRoutes(fastify: FastifyInstance): void {
  fastify.post(
    '/assets/bulk',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => handleBulkAssets(request, reply)
  );
}

async function handleBulkAssets(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const body = request.body as BulkActionBody;
  const assetIds = normalizeAssetIds(body.assetIds);

  if (assetIds.length === 0) {
    return reply.code(400).send({ error: 'assetIds are required' });
  }

  if (!body.brandId || typeof body.brandId !== 'string') {
    return reply.code(400).send({ error: 'brandId is required' });
  }
  const ownedAssets = await prismaAssets.asset.count({
    where: { id: { in: assetIds }, brandId: body.brandId },
  });
  if (ownedAssets !== assetIds.length) {
    return reply.code(403).send({ error: 'All assets must belong to the selected brand' });
  }

  if (!body.action || typeof body.action !== 'object') {
    return reply.code(400).send({ error: 'action is required' });
  }

  if ('move_to_collection' in body.action) {
    return moveAssetsToCollection(
      assetIds,
      body.brandId,
      body.action.move_to_collection.collectionId,
      reply
    );
  }

  if ('add_labels' in body.action) {
    return addLabelsToAssets(assetIds, body.brandId, body.action.add_labels, reply);
  }

  if ('remove_labels' in body.action) {
    return removeLabelsFromAssets(assetIds, body.brandId, body.action.remove_labels.labelIds ?? []);
  }

  if ('delete' in body.action) {
    return deleteAssets(assetIds, body.brandId);
  }

  return reply.code(400).send({ error: 'Unsupported action' });
}

function normalizeAssetIds(assetIds: string[] | undefined): string[] {
  if (!Array.isArray(assetIds)) {
    return [];
  }

  return Array.from(new Set(assetIds.filter((id) => typeof id === 'string' && id.length > 0)));
}

async function moveAssetsToCollection(
  assetIds: string[],
  brandId: string,
  collectionId: string | null | undefined,
  reply: FastifyReply
): Promise<unknown> {
  if (collectionId) {
    const collection = await prismaAssets.assetTaxonomyItem.findUnique({
      where: { id: collectionId },
      select: { id: true, brandId: true, type: true },
    });

    if (collection?.type !== 'COLLECTION' || (brandId && collection.brandId !== brandId)) {
      return reply.code(400).send({ error: 'Invalid collection selection' });
    }
  }

  await prismaAssets.asset.updateMany({
    where: { id: { in: assetIds }, brandId },
    data: { collectionId: collectionId ?? null },
  });

  return { success: true };
}

async function addLabelsToAssets(
  assetIds: string[],
  brandId: string,
  action: { labelIds?: string[]; labelNames?: string[]; createdBy?: string },
  reply: FastifyReply
): Promise<unknown> {
  const labelIds = new Set<string>();
  const createdBy = action.createdBy ?? 'system';

  action.labelIds?.forEach((id) => {
    if (id) {
      labelIds.add(id);
    }
  });

  if (action.labelNames && action.labelNames.length > 0) {
    if (!brandId) {
      return reply.code(400).send({ error: 'brandId is required to create labels' });
    }

    const ids = await ensureLabelsExist(brandId, action.labelNames, createdBy);
    ids.forEach((id) => labelIds.add(id));
  }

  const labelsToAssign = Array.from(labelIds);
  const validLabels = await prismaAssets.assetTaxonomyItem.count({
    where: { id: { in: labelsToAssign }, brandId, type: 'LABEL', deletedAt: null },
  });
  if (validLabels !== labelsToAssign.length) {
    return reply.code(400).send({ error: 'Invalid labels for brand' });
  }
  if (labelsToAssign.length === 0) {
    return { success: true };
  }

  const assignments = assetIds.flatMap((assetId) =>
    labelsToAssign.map((taxonomyItemId) => ({ assetId, taxonomyItemId, createdBy }))
  );

  await prismaAssets.assetTaxonomyAssignment.createMany({
    data: assignments,
    skipDuplicates: true,
  });

  return { success: true };
}

async function removeLabelsFromAssets(
  assetIds: string[],
  brandId: string,
  labelIds: string[]
): Promise<{ success: true }> {
  if (labelIds.length === 0) {
    return { success: true };
  }

  await prismaAssets.assetTaxonomyAssignment.deleteMany({
    where: {
      assetId: { in: assetIds },
      asset: { brandId },
      taxonomyItemId: { in: labelIds },
    },
  });

  return { success: true };
}

async function deleteAssets(assetIds: string[], brandId: string): Promise<{ success: true }> {
  const where: AssetsPrisma.AssetWhereInput = {
    id: { in: assetIds },
    brandId,
  };

  const assetsToDelete = await prismaAssets.asset.findMany({
    where,
    select: {
      id: true,
      s3Key: true,
      thumbnailKey: true,
      thumbnailSmallKey: true,
      thumbnailLargeKey: true,
    },
  });

  if (assetsToDelete.length === 0) {
    return { success: true };
  }

  const storageKeys = assetsToDelete.flatMap((asset) =>
    [asset.s3Key, asset.thumbnailKey, asset.thumbnailSmallKey, asset.thumbnailLargeKey].filter(
      (key): key is string => !!key
    )
  );

  await deleteS3Objects(storageKeys, brandId);
  await prismaAssets.asset.deleteMany({
    where: { id: { in: assetsToDelete.map((asset) => asset.id) }, brandId },
  });

  return { success: true };
}
