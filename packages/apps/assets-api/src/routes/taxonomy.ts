import type { FastifyPluginAsync } from 'fastify';
import { normalizeAssetLabelName, prismaAssets } from '@postolio/database-assets';

type TreeNode<T extends { id: string; parentId?: string | null }> = T & {
  children: Array<TreeNode<T>>;
};

function buildTree<T extends { id: string; parentId?: string | null }>(items: T[]) {
  const byId = new Map<string, TreeNode<T>>();
  const roots: Array<TreeNode<T>> = [];

  items.forEach((item) => {
    byId.set(item.id, { ...item, children: [] });
  });

  items.forEach((item) => {
    const node = byId.get(item.id);
    if (!node) {
      return;
    }
    if (item.parentId && byId.has(item.parentId)) {
      byId.get(item.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
}

type CollectionWithCount = TreeNode<{
  id: string;
  parentId?: string | null;
  assetCount?: number;
}>;

function withSubtreeCounts(nodes: CollectionWithCount[]): CollectionWithCount[] {
  return nodes.map((node) => {
    const children = withSubtreeCounts(node.children);
    const descendantsCount = children.reduce((sum, child) => sum + (child.assetCount ?? 0), 0);
    return {
      ...node,
      children,
      assetCount: (node.assetCount ?? 0) + descendantsCount,
    };
  });
}

const taxonomyRoutes: FastifyPluginAsync = async (fastify) => {
  // List taxonomy items
  fastify.get(
    '/taxonomy',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => {
      const query = request.query as {
        brandId?: string;
        type?: 'COLLECTION' | 'LABEL';
        format?: 'tree' | 'flat';
        includeArchived?: string;
      };

      if (!query.brandId) {
        return reply.code(400).send({ error: 'brandId is required' });
      }
      if (!query.type) {
        return reply.code(400).send({ error: 'type is required' });
      }

      if (query.type === 'COLLECTION') {
        const collections = await prismaAssets.assetTaxonomyItem.findMany({
          where: {
            brandId: query.brandId,
            type: 'COLLECTION',
            deletedAt: null,
          },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        });

        const collectionIds = collections.map((collection) => collection.id);
        const assetCounts = collectionIds.length
          ? await prismaAssets.asset.groupBy({
              by: ['collectionId'],
              where: {
                brandId: query.brandId,
                archivedAt: null,
                collectionId: { in: collectionIds },
              },
              _count: { id: true },
            })
          : [];
        const directCountMap = new Map(
          assetCounts
            .filter((row) => !!row.collectionId)
            .map((row) => [row.collectionId as string, row._count.id])
        );
        const unsortedAssetCount = await prismaAssets.asset.count({
          where: {
            brandId: query.brandId,
            archivedAt: null,
            collectionId: null,
          },
        });

        const collectionsWithCounts = collections.map((collection) => ({
          ...collection,
          assetCount: directCountMap.get(collection.id) ?? 0,
        }));

        if (query.format === 'tree') {
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

      const includeArchived = query.includeArchived === 'true' || query.includeArchived === '1';
      const labels = await prismaAssets.assetTaxonomyItem.findMany({
        where: {
          brandId: query.brandId,
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

      const labelsWithCounts = labels.map((label) => ({
        ...label,
        assetCount: countMap.get(label.id) ?? 0,
      }));

      return { labels: labelsWithCounts };
    }
  );

  // Create taxonomy item
  fastify.post(
    '/taxonomy',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => {
      const body = request.body as {
        brandId: string;
        type: 'COLLECTION' | 'LABEL';
        name: string;
        parentId?: string | null;
        color?: string;
        sortOrder?: number;
        isSystem?: boolean;
        createdBy?: string;
      };

      if (!body.brandId || !body.type || !body.name) {
        return reply.code(400).send({ error: 'brandId, type, and name are required' });
      }

      if (body.type === 'LABEL' && body.parentId) {
        return reply.code(400).send({ error: 'Labels cannot have a parent collection' });
      }

      if (body.isSystem && body.createdBy !== 'system') {
        return reply.code(403).send({ error: 'Only system can create system labels' });
      }

      const name = body.name.trim();
      const nameNorm = body.type === 'LABEL' ? normalizeAssetLabelName(name) : null;

      try {
        const item = await prismaAssets.assetTaxonomyItem.create({
          data: {
            brandId: body.brandId,
            type: body.type,
            name,
            nameNorm,
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
  );

  // Update taxonomy item
  fastify.patch(
    '/taxonomy/:id',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        brandId?: string;
        name?: string;
        parentId?: string | null;
        sortOrder?: number;
        color?: string;
        createdBy?: string;
      };

      const existing = await prismaAssets.assetTaxonomyItem.findUnique({
        where: { id },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'Taxonomy item not found' });
      }

      if (body.brandId && existing.brandId !== body.brandId) {
        return reply.code(403).send({ error: 'Taxonomy item does not belong to brand' });
      }

      if (existing.isSystem && body.createdBy !== 'system') {
        return reply.code(403).send({ error: 'System labels are read-only' });
      }

      if (existing.type === 'LABEL' && body.parentId) {
        return reply.code(400).send({ error: 'Labels cannot be moved into collections' });
      }

      const name = body.name ? body.name.trim() : undefined;
      const nameNorm =
        name && existing.type === 'LABEL' ? normalizeAssetLabelName(name) : undefined;

      try {
        const item = await prismaAssets.assetTaxonomyItem.update({
          where: { id },
          data: {
            name,
            nameNorm,
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
  );

  // Delete taxonomy item (collections only)
  fastify.delete(
    '/taxonomy/:id',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        brandId?: string;
        onNotEmpty?: 'move_to_parent' | 'move_to_unsorted';
        createdBy?: string;
      };

      const existing = await prismaAssets.assetTaxonomyItem.findUnique({
        where: { id },
        include: { _count: { select: { children: true } } },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'Taxonomy item not found' });
      }

      if (body.brandId && existing.brandId !== body.brandId) {
        return reply.code(403).send({ error: 'Taxonomy item does not belong to brand' });
      }

      if (existing.type === 'LABEL') {
        if (existing.isSystem && body.createdBy !== 'system') {
          return reply.code(403).send({ error: 'System labels are read-only' });
        }
        await prismaAssets.assetTaxonomyItem.update({
          where: { id },
          data: { deletedAt: new Date(), isArchived: true },
        });
        return { success: true };
      }

      if (existing._count.children > 0) {
        return reply
          .code(400)
          .send({ error: 'Collection has subcollections. Move or delete them first.' });
      }

      const assetsCount = await prismaAssets.asset.count({
        where: { collectionId: id },
      });

      if (assetsCount > 0 && !body.onNotEmpty) {
        return reply.code(400).send({
          error: 'Collection is not empty. Provide onNotEmpty to move assets.',
        });
      }

      if (assetsCount > 0) {
        const targetCollectionId =
          body.onNotEmpty === 'move_to_parent' ? (existing.parentId ?? null) : null;
        await prismaAssets.asset.updateMany({
          where: { collectionId: id },
          data: { collectionId: targetCollectionId },
        });
      }

      await prismaAssets.assetTaxonomyItem.delete({ where: { id } });
      return { success: true };
    }
  );

  // Archive label
  fastify.post(
    '/taxonomy/:id/archive',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { brandId?: string; createdBy?: string };

      const label = await prismaAssets.assetTaxonomyItem.findUnique({ where: { id } });
      if (!label) {
        return reply.code(404).send({ error: 'Label not found' });
      }
      if (label.type !== 'LABEL') {
        return reply.code(400).send({ error: 'Only labels can be archived' });
      }
      if (body.brandId && label.brandId !== body.brandId) {
        return reply.code(403).send({ error: 'Label does not belong to brand' });
      }
      if (label.isSystem && body.createdBy !== 'system') {
        return reply.code(403).send({ error: 'System labels are read-only' });
      }

      const item = await prismaAssets.assetTaxonomyItem.update({
        where: { id },
        data: { isArchived: true },
      });

      return { item };
    }
  );

  // Unarchive label
  fastify.post(
    '/taxonomy/:id/unarchive',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { brandId?: string; createdBy?: string };

      const label = await prismaAssets.assetTaxonomyItem.findUnique({ where: { id } });
      if (!label) {
        return reply.code(404).send({ error: 'Label not found' });
      }
      if (label.type !== 'LABEL') {
        return reply.code(400).send({ error: 'Only labels can be unarchived' });
      }
      if (body.brandId && label.brandId !== body.brandId) {
        return reply.code(403).send({ error: 'Label does not belong to brand' });
      }
      if (label.isSystem && body.createdBy !== 'system') {
        return reply.code(403).send({ error: 'System labels are read-only' });
      }

      const item = await prismaAssets.assetTaxonomyItem.update({
        where: { id },
        data: { isArchived: false },
      });

      return { item };
    }
  );

  // Merge labels
  fastify.post(
    '/labels:merge',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => {
      const body = request.body as {
        brandId: string;
        fromLabelId: string;
        intoLabelId: string;
        createdBy?: string;
      };

      if (!body.brandId || !body.fromLabelId || !body.intoLabelId) {
        return reply
          .code(400)
          .send({ error: 'brandId, fromLabelId, and intoLabelId are required' });
      }

      if (body.fromLabelId === body.intoLabelId) {
        return reply.code(400).send({ error: 'fromLabelId and intoLabelId must differ' });
      }

      const [fromLabel, intoLabel] = await Promise.all([
        prismaAssets.assetTaxonomyItem.findUnique({ where: { id: body.fromLabelId } }),
        prismaAssets.assetTaxonomyItem.findUnique({ where: { id: body.intoLabelId } }),
      ]);

      if (!fromLabel || !intoLabel) {
        return reply.code(404).send({ error: 'Label not found' });
      }

      if (fromLabel.brandId !== body.brandId || intoLabel.brandId !== body.brandId) {
        return reply.code(403).send({ error: 'Labels do not belong to brand' });
      }

      if (fromLabel.type !== 'LABEL' || intoLabel.type !== 'LABEL') {
        return reply.code(400).send({ error: 'Both items must be labels' });
      }

      if (fromLabel.isSystem && body.createdBy !== 'system') {
        return reply.code(403).send({ error: 'System labels are read-only' });
      }

      const assignments = await prismaAssets.assetTaxonomyAssignment.findMany({
        where: { taxonomyItemId: fromLabel.id },
        select: { assetId: true },
      });

      if (assignments.length > 0) {
        await prismaAssets.assetTaxonomyAssignment.createMany({
          data: assignments.map((assignment) => ({
            assetId: assignment.assetId,
            taxonomyItemId: intoLabel.id,
            createdBy: body.createdBy ?? 'system',
          })),
          skipDuplicates: true,
        });
      }

      await prismaAssets.assetTaxonomyAssignment.deleteMany({
        where: { taxonomyItemId: fromLabel.id },
      });

      await prismaAssets.assetTaxonomyItem.update({
        where: { id: fromLabel.id },
        data: { deletedAt: new Date(), isArchived: true },
      });

      return { success: true };
    }
  );
};

export default taxonomyRoutes;
