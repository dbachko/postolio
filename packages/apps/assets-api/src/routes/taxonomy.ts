import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { normalizeAssetLabelName, prismaAssets } from '@postolio/database-assets';
import { mergeLabelAssignments } from './taxonomy/merge.js';
import { buildTree, withSubtreeCounts } from './taxonomy/tree.js';
import type {
  ArchiveBody,
  CollectionWithCount,
  CreateTaxonomyBody,
  DeleteTaxonomyBody,
  ListTaxonomyQuery,
  MergeLabelsBody,
  UpdateTaxonomyBody,
} from './taxonomy/types.js';
import {
  validateArchiveRequest,
  validateDeleteRequest,
  validateMergeLabelsRelation,
  validateMergeRequest,
  validateTaxonomyUpdate,
} from './taxonomy/validation.js';

const taxonomyRoutes: FastifyPluginAsync = async (fastify) => {
  registerTaxonomyRoutes(fastify);
};

function registerTaxonomyRoutes(fastify: FastifyInstance): void {
  fastify.get('/taxonomy', { preHandler: [fastify.authenticateService] }, async (request, reply) =>
    handleListTaxonomy(request, reply)
  );
  fastify.post('/taxonomy', { preHandler: [fastify.authenticateService] }, async (request, reply) =>
    handleCreateTaxonomy(request, reply)
  );
  fastify.patch(
    '/taxonomy/:id',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => handleUpdateTaxonomy(request, reply)
  );
  fastify.delete(
    '/taxonomy/:id',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => handleDeleteTaxonomy(request, reply)
  );
  fastify.post(
    '/taxonomy/:id/archive',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => handleArchiveLabel(request, reply)
  );
  fastify.post(
    '/taxonomy/:id/unarchive',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => handleUnarchiveLabel(request, reply)
  );
  fastify.post(
    '/labels:merge',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => handleMergeLabels(request, reply)
  );
}

async function handleListTaxonomy(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const query = request.query as ListTaxonomyQuery;

  if (!query.brandId) {
    return reply.code(400).send({ error: 'brandId is required' });
  }

  if (!query.type) {
    return reply.code(400).send({ error: 'type is required' });
  }

  return query.type === 'COLLECTION'
    ? listCollectionsForBrand(query.brandId, query.format)
    : listLabelsForBrand(query.brandId, query.includeArchived);
}

async function listCollectionsForBrand(
  brandId: string,
  format: 'tree' | 'flat' | undefined
): Promise<unknown> {
  const collections = await prismaAssets.assetTaxonomyItem.findMany({
    where: { brandId, type: 'COLLECTION', deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  const [directCountMap, unsortedAssetCount] = await Promise.all([
    getCollectionDirectCountMap(
      brandId,
      collections.map((collection) => collection.id)
    ),
    prismaAssets.asset.count({ where: { brandId, archivedAt: null, collectionId: null } }),
  ]);

  const collectionsWithCounts = collections.map((collection) => ({
    ...collection,
    assetCount: directCountMap.get(collection.id) ?? 0,
  }));

  if (format === 'tree') {
    const tree = buildTree(
      collectionsWithCounts.map((collection) => ({
        ...collection,
        parentId: collection.parentId ?? null,
      }))
    ) as CollectionWithCount[];

    return { collections: withSubtreeCounts(tree), unsortedAssetCount };
  }

  return { collections: collectionsWithCounts, unsortedAssetCount };
}

async function getCollectionDirectCountMap(
  brandId: string,
  collectionIds: string[]
): Promise<Map<string, number>> {
  if (collectionIds.length === 0) {
    return new Map<string, number>();
  }

  const counts = await prismaAssets.asset.groupBy({
    by: ['collectionId'],
    where: { brandId, archivedAt: null, collectionId: { in: collectionIds } },
    _count: { id: true },
  });

  return new Map(
    counts
      .filter((row) => !!row.collectionId)
      .map((row) => [row.collectionId as string, row._count.id])
  );
}

async function listLabelsForBrand(
  brandId: string,
  includeArchivedRaw: string | undefined
): Promise<unknown> {
  const includeArchived = includeArchivedRaw === 'true' || includeArchivedRaw === '1';

  const labels = await prismaAssets.assetTaxonomyItem.findMany({
    where: {
      brandId,
      type: 'LABEL',
      deletedAt: null,
      ...(includeArchived ? {} : { isArchived: false }),
    },
    orderBy: { name: 'asc' },
  });

  const counts = labels.length
    ? await prismaAssets.assetTaxonomyAssignment.groupBy({
        by: ['taxonomyItemId'],
        where: { taxonomyItemId: { in: labels.map((label) => label.id) } },
        _count: { assetId: true },
      })
    : [];

  const countMap = new Map(counts.map((row) => [row.taxonomyItemId, row._count.assetId]));
  return {
    labels: labels.map((label) => ({ ...label, assetCount: countMap.get(label.id) ?? 0 })),
  };
}

async function handleCreateTaxonomy(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<unknown> {
  const body = request.body as CreateTaxonomyBody;

  if (!body.brandId || !body.type || !body.name) {
    return reply.code(400).send({ error: 'brandId, type, and name are required' });
  }

  if (body.type === 'LABEL' && body.parentId) {
    return reply.code(400).send({ error: 'Labels cannot have a parent collection' });
  }

  if (body.isSystem && body.createdBy !== 'system') {
    return reply.code(403).send({ error: 'Only system can create system labels' });
  }

  try {
    const name = body.name.trim();
    const item = await prismaAssets.assetTaxonomyItem.create({
      data: {
        brandId: body.brandId,
        type: body.type,
        name,
        nameNorm: body.type === 'LABEL' ? normalizeAssetLabelName(name) : null,
        parentId: body.parentId ?? undefined,
        color: body.color,
        sortOrder: body.sortOrder,
        isSystem: body.isSystem ?? false,
        createdBy: body.createdBy,
      },
    });

    return { item };
  } catch (error) {
    request.log.error(error, 'Failed to create taxonomy item');
    return reply.code(500).send({ error: 'Failed to create taxonomy item' });
  }
}

async function handleUpdateTaxonomy(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<unknown> {
  const { id } = request.params as { id: string };
  const body = request.body as UpdateTaxonomyBody;
  const existing = await prismaAssets.assetTaxonomyItem.findUnique({ where: { id } });

  if (!existing) {
    return reply.code(404).send({ error: 'Taxonomy item not found' });
  }

  const validationError = validateTaxonomyUpdate(existing, body);
  if (validationError) {
    return reply.code(validationError.statusCode).send({ error: validationError.message });
  }

  try {
    const name = body.name ? body.name.trim() : undefined;
    const item = await prismaAssets.assetTaxonomyItem.update({
      where: { id },
      data: {
        name,
        nameNorm: name && existing.type === 'LABEL' ? normalizeAssetLabelName(name) : undefined,
        parentId: body.parentId ?? undefined,
        sortOrder: body.sortOrder,
        color: body.color,
      },
    });

    return { item };
  } catch (error) {
    request.log.error(error, 'Failed to update taxonomy item');
    return reply.code(500).send({ error: 'Failed to update taxonomy item' });
  }
}

async function handleDeleteTaxonomy(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<unknown> {
  const { id } = request.params as { id: string };
  const body = request.body as DeleteTaxonomyBody;

  const existing = await prismaAssets.assetTaxonomyItem.findUnique({
    where: { id },
    include: { _count: { select: { children: true } } },
  });

  if (!existing) {
    return reply.code(404).send({ error: 'Taxonomy item not found' });
  }

  const validationError = validateDeleteRequest(existing, body);
  if (validationError) {
    return reply.code(validationError.statusCode).send({ error: validationError.message });
  }

  if (existing.type === 'LABEL') {
    await prismaAssets.assetTaxonomyItem.update({
      where: { id },
      data: { deletedAt: new Date(), isArchived: true },
    });
    return { success: true };
  }

  return deleteCollection(existing.id, existing.parentId ?? null, body.onNotEmpty, reply);
}

async function deleteCollection(
  collectionId: string,
  parentId: string | null,
  onNotEmpty: DeleteTaxonomyBody['onNotEmpty'],
  reply: FastifyReply
): Promise<unknown> {
  const assetsCount = await prismaAssets.asset.count({ where: { collectionId } });

  if (assetsCount > 0 && !onNotEmpty) {
    return reply.code(400).send({
      error: 'Collection is not empty. Provide onNotEmpty to move assets.',
    });
  }

  if (assetsCount > 0) {
    const targetCollectionId = onNotEmpty === 'move_to_parent' ? parentId : null;
    await prismaAssets.asset.updateMany({
      where: { collectionId },
      data: { collectionId: targetCollectionId },
    });
  }

  await prismaAssets.assetTaxonomyItem.delete({ where: { id: collectionId } });
  return { success: true };
}

async function handleArchiveLabel(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  return toggleLabelArchiveState(request, reply, true);
}

async function handleUnarchiveLabel(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<unknown> {
  return toggleLabelArchiveState(request, reply, false);
}

async function toggleLabelArchiveState(
  request: FastifyRequest,
  reply: FastifyReply,
  isArchived: boolean
): Promise<unknown> {
  const { id } = request.params as { id: string };
  const body = request.body as ArchiveBody;
  const label = await prismaAssets.assetTaxonomyItem.findUnique({ where: { id } });

  const validationError = validateArchiveRequest(label, body);
  if (validationError) {
    return reply.code(validationError.statusCode).send({ error: validationError.message });
  }

  const item = await prismaAssets.assetTaxonomyItem.update({ where: { id }, data: { isArchived } });
  return { item };
}

async function handleMergeLabels(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const body = request.body as MergeLabelsBody;
  const validationError = validateMergeRequest(body);
  if (validationError) {
    return reply.code(400).send({ error: validationError });
  }

  const [fromLabel, intoLabel] = await Promise.all([
    prismaAssets.assetTaxonomyItem.findUnique({ where: { id: body.fromLabelId } }),
    prismaAssets.assetTaxonomyItem.findUnique({ where: { id: body.intoLabelId } }),
  ]);

  const relationError = validateMergeLabelsRelation(fromLabel, intoLabel, body);
  if (relationError) {
    return reply.code(relationError.statusCode).send({ error: relationError.message });
  }

  await mergeLabelAssignments(fromLabel!.id, intoLabel!.id, body.createdBy ?? 'system');
  await prismaAssets.assetTaxonomyItem.update({
    where: { id: fromLabel!.id },
    data: { deletedAt: new Date(), isArchived: true },
  });

  return { success: true };
}

export default taxonomyRoutes;
