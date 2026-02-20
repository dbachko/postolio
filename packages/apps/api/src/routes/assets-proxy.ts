import { FastifyPluginAsync } from 'fastify';
import {
  AssetsServiceClient,
  DeleteAssetResponse,
  ListAssetsResponse,
  type AssetRecord,
  type BulkAssetAction,
} from '@postolio/assets-client';
import { config } from '../config/env-validation.js';
import { getDatabaseClient } from '../config/database.js';
import { formatError } from '../utils/logging.js';
import { assertBrandOwnership } from '../services/ownership.js';

const assetsClient = new AssetsServiceClient({
  baseUrl: config.ASSETS_API_BASE_URL,
  serviceToken: config.ASSETS_API_SERVICE_TOKEN,
});

export const assetsProxyRoutes: FastifyPluginAsync = async (fastify) => {
  const prisma = getDatabaseClient();

  const ensureBrandOwned = async (brandId: string, userId: string) => {
    try {
      await assertBrandOwnership(userId, brandId);
      return {
        owns: true,
      };
    } catch {
      return {
        owns: false,
      };
    }
  };

  const ensureAssetOwned = async (assetId: string, userId: string) => {
    const asset = await assetsClient.getAsset(assetId);
    const { owns } = await ensureBrandOwned(asset.brandId, userId);
    if (!owns) {
      return null;
    }
    return asset;
  };

  fastify.post('/upload-url', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const { brandId, fileName, contentType, fileType, fileSize } = request.body as {
        brandId: string;
        fileName: string;
        contentType: string;
        fileType: 'image' | 'video';
        fileSize: number;
      };

      if (!brandId || !fileName || !contentType || !fileType || fileSize == null) {
        return reply.code(400).send({ error: 'Missing required fields' });
      }

      const { owns } = await ensureBrandOwned(brandId, userId);
      if (!owns) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      const result = await assetsClient.getUploadUrl({
        brandId,
        fileName,
        contentType,
        fileType,
        fileSize,
      });

      return reply.send(result);
    } catch (error) {
      request.log.error(formatError(error), 'Failed to proxy assets upload-url');
      return reply.code(500).send({ error: 'Failed to generate upload URL' });
    }
  });

  // Create asset metadata (post-upload)
  fastify.post('/', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const body = request.body as {
        brandId: string;
        fileName: string;
        s3Key: string;
        fileSize: number;
        mimeType: string;
        fileType: 'image' | 'video';
        width?: number;
        height?: number;
        duration?: number;
        title?: string;
        altText?: string;
        description?: string;
        collectionId?: string | null;
        labelIds?: string[];
      };

      if (!body.brandId || !body.fileName || !body.s3Key || !body.mimeType || !body.fileType) {
        return reply.code(400).send({ error: 'Missing required fields' });
      }

      const ownsBrand = await ensureBrandOwned(body.brandId, userId);
      if (!ownsBrand.owns) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      const result = await assetsClient.createAsset({
        ...body,
        uploadedBy: userId,
      });

      return reply.send(result);
    } catch (error) {
      request.log.error(formatError(error), 'Failed to proxy asset create');
      return reply.code(500).send({ error: 'Failed to create asset' });
    }
  });

  // List assets (brand required)
  fastify.get<{
    Querystring: {
      brandId?: string;
      type?: 'image' | 'video';
      search?: string;
      page?: string;
      limit?: string;
      collectionId?: string;
      includeSubcollections?: string;
      labelIds?: string[];
      labelMode?: 'any' | 'all';
      // New filter parameters
      aspectRatio?: string;
      aspectRatios?: string[];
      orientationTypes?: Array<'portrait' | 'landscape' | 'square'>;
      minWidth?: string;
      maxWidth?: string;
      minHeight?: string;
      maxHeight?: string;
      uploadedAfter?: string;
      uploadedBefore?: string;
      usage?: 'used' | 'unused' | 'any';
    };
  }>('/', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const {
        brandId,
        type,
        search,
        page,
        limit,
        collectionId,
        includeSubcollections,
        labelIds,
        labelMode,
        aspectRatio,
        aspectRatios,
        orientationTypes,
        minWidth,
        maxWidth,
        minHeight,
        maxHeight,
        uploadedAfter,
        uploadedBefore,
        usage,
      } = request.query;

      if (!brandId) {
        return reply.code(400).send({ error: 'brandId is required' });
      }

      const { owns } = await ensureBrandOwned(brandId, userId);
      if (!owns) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      const result: ListAssetsResponse = await assetsClient.listAssets({
        brandId,
        type,
        search,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        collectionId: collectionId || undefined,
        includeSubcollections: includeSubcollections === 'true' || includeSubcollections === '1',
        labelIds: labelIds,
        labelMode,
        // Forward new filter parameters
        aspectRatio,
        aspectRatios,
        orientationTypes,
        minWidth: minWidth ? Number(minWidth) : undefined,
        maxWidth: maxWidth ? Number(maxWidth) : undefined,
        minHeight: minHeight ? Number(minHeight) : undefined,
        maxHeight: maxHeight ? Number(maxHeight) : undefined,
        uploadedAfter,
        uploadedBefore,
        usage,
      });

      return reply.send(result);
    } catch (error) {
      request.log.error(formatError(error), 'Failed to proxy assets list');
      return reply.code(500).send({ error: 'Failed to fetch assets' });
    }
  });

  // List taxonomy (collections/labels)
  fastify.get<{
    Querystring: {
      brandId?: string;
      type?: 'COLLECTION' | 'LABEL';
      format?: 'tree' | 'flat';
      includeArchived?: string;
    };
  }>('/taxonomy', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const { brandId, type, format, includeArchived } = request.query;

      if (!brandId || !type) {
        return reply.code(400).send({ error: 'brandId and type are required' });
      }

      const { owns } = await ensureBrandOwned(brandId, userId);
      if (!owns) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      const result = await assetsClient.listTaxonomy({
        brandId,
        type,
        format,
        includeArchived: includeArchived === 'true' || includeArchived === '1',
      });

      return reply.send(result);
    } catch (error) {
      request.log.error(formatError(error), 'Failed to proxy taxonomy list');
      return reply.code(500).send({ error: 'Failed to fetch taxonomy' });
    }
  });

  // Create taxonomy item
  fastify.post('/taxonomy', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const body = request.body as {
        brandId: string;
        type: 'COLLECTION' | 'LABEL';
        name: string;
        parentId?: string | null;
        color?: string;
        sortOrder?: number;
        isSystem?: boolean;
      };

      if (!body.brandId || !body.type || !body.name) {
        return reply.code(400).send({ error: 'brandId, type, and name are required' });
      }

      const { owns } = await ensureBrandOwned(body.brandId, userId);
      if (!owns) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      const result = await assetsClient.createTaxonomy({
        brandId: body.brandId,
        type: body.type,
        name: body.name,
        parentId: body.parentId,
        color: body.color,
        sortOrder: body.sortOrder,
        createdBy: userId,
      });

      return reply.send(result);
    } catch (error) {
      request.log.error(formatError(error), 'Failed to create taxonomy item');
      return reply.code(500).send({ error: 'Failed to create taxonomy item' });
    }
  });

  // Update taxonomy item
  fastify.patch('/taxonomy/:id', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const { id } = request.params as { id: string };
      const body = request.body as {
        brandId: string;
        name?: string;
        parentId?: string | null;
        sortOrder?: number;
        color?: string;
      };

      if (!body.brandId) {
        return reply.code(400).send({ error: 'brandId is required' });
      }

      const { owns } = await ensureBrandOwned(body.brandId, userId);
      if (!owns) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      const result = await assetsClient.updateTaxonomy(id, {
        ...body,
        createdBy: userId,
      });

      return reply.send(result);
    } catch (error) {
      request.log.error(formatError(error), 'Failed to update taxonomy item');
      return reply.code(500).send({ error: 'Failed to update taxonomy item' });
    }
  });

  // Delete taxonomy item
  fastify.delete('/taxonomy/:id', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const { id } = request.params as { id: string };
      const body = request.body as {
        brandId: string;
        onNotEmpty?: 'move_to_parent' | 'move_to_unsorted';
      };

      if (!body.brandId) {
        return reply.code(400).send({ error: 'brandId is required' });
      }

      const { owns } = await ensureBrandOwned(body.brandId, userId);
      if (!owns) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      const result = await assetsClient.deleteTaxonomy(id, {
        brandId: body.brandId,
        onNotEmpty: body.onNotEmpty,
        createdBy: userId,
      });

      return reply.send(result);
    } catch (error) {
      request.log.error(formatError(error), 'Failed to delete taxonomy item');
      return reply.code(500).send({ error: 'Failed to delete taxonomy item' });
    }
  });

  fastify.post(
    '/taxonomy/:id/archive',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id } = request.params as { id: string };
        const body = request.body as { brandId: string };

        if (!body.brandId) {
          return reply.code(400).send({ error: 'brandId is required' });
        }

        const { owns } = await ensureBrandOwned(body.brandId, userId);
        if (!owns) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        const result = await assetsClient.archiveTaxonomy(id, {
          brandId: body.brandId,
          createdBy: userId,
        });

        return reply.send(result);
      } catch (error) {
        request.log.error(formatError(error), 'Failed to archive label');
        return reply.code(500).send({ error: 'Failed to archive label' });
      }
    }
  );

  fastify.post(
    '/taxonomy/:id/unarchive',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id } = request.params as { id: string };
        const body = request.body as { brandId: string };

        if (!body.brandId) {
          return reply.code(400).send({ error: 'brandId is required' });
        }

        const { owns } = await ensureBrandOwned(body.brandId, userId);
        if (!owns) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        const result = await assetsClient.unarchiveTaxonomy(id, {
          brandId: body.brandId,
          createdBy: userId,
        });

        return reply.send(result);
      } catch (error) {
        request.log.error(formatError(error), 'Failed to unarchive label');
        return reply.code(500).send({ error: 'Failed to unarchive label' });
      }
    }
  );

  // Merge labels
  fastify.post('/labels:merge', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const body = request.body as { brandId: string; fromLabelId: string; intoLabelId: string };

      if (!body.brandId || !body.fromLabelId || !body.intoLabelId) {
        return reply
          .code(400)
          .send({ error: 'brandId, fromLabelId, and intoLabelId are required' });
      }

      const { owns } = await ensureBrandOwned(body.brandId, userId);
      if (!owns) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      const result = await assetsClient.mergeLabels({
        ...body,
        createdBy: userId,
      });

      return reply.send(result);
    } catch (error) {
      request.log.error(formatError(error), 'Failed to merge labels');
      return reply.code(500).send({ error: 'Failed to merge labels' });
    }
  });

  // Bulk asset actions
  fastify.post('/bulk', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const body = request.body as {
        brandId: string;
        assetIds: string[];
        action: BulkAssetAction;
      };

      if (!body.brandId || !Array.isArray(body.assetIds) || body.assetIds.length === 0) {
        return reply.code(400).send({ error: 'brandId and assetIds are required' });
      }

      const { owns } = await ensureBrandOwned(body.brandId, userId);
      if (!owns) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      const result = await assetsClient.bulkAssets({
        ...body,
      });

      return reply.send(result);
    } catch (error) {
      request.log.error(formatError(error), 'Failed to perform bulk asset action');
      return reply.code(500).send({ error: 'Failed to perform bulk asset action' });
    }
  });

  // Check whether assets are used in posts (per brand)
  fastify.post<{
    Body: {
      assetIds?: string[];
      brandId?: string;
    };
  }>('/usage', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const { assetIds, brandId } = request.body;

      const normalizedIds = Array.isArray(assetIds)
        ? Array.from(
            new Set(
              assetIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
            )
          )
        : [];

      if (!brandId || normalizedIds.length === 0) {
        return reply.code(400).send({ error: 'brandId and assetIds are required' });
      }

      const { owns } = await ensureBrandOwned(brandId, userId);
      if (!owns) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      const usage = await prisma.contentMediaAsset.groupBy({
        by: ['assetId'],
        _count: { _all: true },
        where: {
          assetId: { in: normalizedIds },
          content: { brandId },
        },
      });

      const counts = new Map(usage.map((row) => [row.assetId, row._count._all ?? 0]));
      const results = normalizedIds.map((assetId) => {
        const postCount = counts.get(assetId) ?? 0;
        return {
          assetId,
          usedInPosts: postCount > 0,
          postCount,
        };
      });

      return reply.send({ usage: results });
    } catch (error) {
      request.log.error(formatError(error), 'Failed to check asset usage');
      return reply.code(500).send({ error: 'Failed to check asset usage' });
    }
  });

  // Batch fetch assets (used by UI to resolve assetId -> metadata)
  fastify.post<{
    Body: {
      assetIds?: string[];
    };
  }>('/batch', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const { assetIds } = request.body;

      const normalizedIds = Array.isArray(assetIds)
        ? Array.from(
            new Set(
              assetIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
            )
          )
        : [];

      if (normalizedIds.length === 0) {
        return reply.code(400).send({ error: 'assetIds is required' });
      }

      const assets = await assetsClient.getBatchAssets(normalizedIds);
      const presentAssets = assets.filter(Boolean) as AssetRecord[];
      const uniqueBrandIds = Array.from(new Set(presentAssets.map((asset) => asset.brandId)));

      const ownedBrandIds = new Set<string>();
      for (const brandId of uniqueBrandIds) {
        const { owns } = await ensureBrandOwned(brandId, userId);
        if (owns) ownedBrandIds.add(brandId);
      }

      const assetsById: Record<string, AssetRecord | null> = {};
      normalizedIds.forEach((assetId, idx) => {
        const asset = assets[idx] ?? null;
        if (!asset) {
          assetsById[assetId] = null;
          return;
        }
        assetsById[assetId] = ownedBrandIds.has(asset.brandId) ? asset : null;
      });

      return reply.send({ assets: assetsById });
    } catch (error) {
      request.log.error(formatError(error), 'Failed to batch fetch assets');
      return reply.code(500).send({ error: 'Failed to fetch assets' });
    }
  });

  // Get asset
  fastify.get('/:id', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const { id } = request.params as { id: string };
      const asset = await ensureAssetOwned(id, userId);
      if (!asset) {
        return reply.code(404).send({ error: 'Asset not found' });
      }
      return reply.send({ asset });
    } catch (error) {
      request.log.error(formatError(error), 'Failed to proxy asset get');
      return reply.code(500).send({ error: 'Failed to fetch asset' });
    }
  });

  // Update asset
  fastify.patch('/:id', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const { id } = request.params as { id: string };
      const existing = await ensureAssetOwned(id, userId);
      if (!existing) {
        return reply.code(404).send({ error: 'Asset not found' });
      }

      const body = request.body as Record<string, unknown>;
      const result = await assetsClient.updateAsset(id, body);
      return reply.send(result);
    } catch (error) {
      request.log.error(formatError(error), 'Failed to proxy asset update');
      return reply.code(500).send({ error: 'Failed to update asset' });
    }
  });

  // Delete asset
  fastify.delete('/:id', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const { id } = request.params as { id: string };
      const existing = await ensureAssetOwned(id, userId);
      if (!existing) {
        return reply.code(404).send({ error: 'Asset not found' });
      }

      const result: DeleteAssetResponse = await assetsClient.deleteAsset(id);
      return reply.send(result);
    } catch (error) {
      request.log.error(formatError(error), 'Failed to proxy asset delete');
      return reply.code(500).send({ error: 'Failed to delete asset' });
    }
  });
};

export default assetsProxyRoutes;
