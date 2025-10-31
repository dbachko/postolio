import { FastifyPluginAsync } from 'fastify';
import { prismaAssets } from '@postolio/database-assets';

const foldersRoutes: FastifyPluginAsync = async (fastify) => {
  // List folders for a brand
  fastify.get('/folders', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const query = request.query as { brandId?: string };

    try {
      if (!query.brandId) {
        return reply.code(400).send({ error: 'brandId is required' });
      }

      const folders = await prismaAssets.assetFolder.findMany({
        where: { brandId: query.brandId },
        include: {
          _count: {
            select: {
              assets: true,
              children: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return { folders };
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({
        error: error instanceof Error ? error.message : 'Failed to fetch folders',
      });
    }
  });

  // Create folder
  fastify.post('/folders', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const body = request.body as {
      brandId: string;
      name: string;
      parentId?: string;
      color?: string;
      folderType?: 'general' | 'campaign_pool' | 'brand_assets';
    };

    try {
      const { brandId, name, parentId, color, folderType } = body;

      if (!brandId || !name) {
        return reply.code(400).send({ error: 'brandId and name are required' });
      }

      // Check for circular reference if parentId is provided
      if (parentId) {
        let currentParentId: string | null = parentId;
        const visitedIds = new Set<string>();

        while (currentParentId) {
          if (visitedIds.has(currentParentId)) {
            return reply.code(400).send({ error: 'Circular folder reference detected' });
          }

          visitedIds.add(currentParentId);

          const parent = await prismaAssets.assetFolder.findUnique({
            where: { id: currentParentId },
            select: { parentId: true },
          });

          if (!parent) {
            return reply.code(404).send({ error: 'Parent folder not found' });
          }

          currentParentId = parent.parentId;
        }
      }

      const folder = await prismaAssets.assetFolder.create({
        data: {
          brandId,
          name,
          parentId,
          color,
          folderType: folderType || 'general',
        },
      });

      return {
        folder,
        message: 'Folder created successfully',
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({
        error: error instanceof Error ? error.message : 'Failed to create folder',
      });
    }
  });

  // Update folder
  fastify.patch('/folders/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      name?: string;
      color?: string;
      parentId?: string | null;
    };

    try {
      // Check for circular reference if moving to a new parent
      if (body.parentId) {
        let currentParentId: string | null = body.parentId;
        const visitedIds = new Set<string>([id]); // Include the folder itself

        while (currentParentId) {
          if (visitedIds.has(currentParentId)) {
            return reply.code(400).send({ error: 'Circular folder reference detected' });
          }

          visitedIds.add(currentParentId);

          const parent = await prismaAssets.assetFolder.findUnique({
            where: { id: currentParentId },
            select: { parentId: true },
          });

          if (!parent) {
            return reply.code(404).send({ error: 'Parent folder not found' });
          }

          currentParentId = parent.parentId;
        }
      }

      const folder = await prismaAssets.assetFolder.update({
        where: { id },
        data: {
          name: body.name,
          color: body.color,
          parentId: body.parentId,
        },
      });

      return {
        folder,
        message: 'Folder updated successfully',
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({
        error: error instanceof Error ? error.message : 'Failed to update folder',
      });
    }
  });

  // Delete folder
  fastify.delete('/folders/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      // Check if folder has children
      const folder = await prismaAssets.assetFolder.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              children: true,
              assets: true,
            },
          },
        },
      });

      if (!folder) {
        return reply.code(404).send({ error: 'Folder not found' });
      }

      if (folder._count.children > 0) {
        return reply.code(400).send({
          error: 'Cannot delete folder with subfolders. Please delete or move subfolders first.',
        });
      }

      // Move assets to null folder (unorganized)
      if (folder._count.assets > 0) {
        await prismaAssets.asset.updateMany({
          where: { folderId: id },
          data: { folderId: null },
        });
      }

      await prismaAssets.assetFolder.delete({
        where: { id },
      });

      return {
        success: true,
        message: 'Folder deleted successfully',
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({
        error: error instanceof Error ? error.message : 'Failed to delete folder',
      });
    }
  });
};

export default foldersRoutes;
