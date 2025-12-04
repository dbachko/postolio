import { FastifyPluginAsync } from 'fastify';
import {
  AssetsServiceClient,
  DeleteAssetResponse,
  ListAssetsResponse,
} from '@postolio/assets-client';
import { config } from '../config/env-validation.js';
import { getDatabaseClient } from '../config/database.js';
import { formatError } from '../utils/logging.js';

const assetsClient = new AssetsServiceClient({
  baseUrl: config.ASSETS_API_BASE_URL,
  serviceToken: config.ASSETS_API_SERVICE_TOKEN,
});

export const assetsProxyRoutes: FastifyPluginAsync = async (fastify) => {
  const prisma = getDatabaseClient();

  const ensureBrandOwned = async (brandId: string, userId: string) => {
    const brand = await prisma.brand.findFirst({
      where: { id: brandId, userId },
      select: { id: true },
    });
    return !!brand;
  };

  const ensureAssetOwned = async (assetId: string, userId: string) => {
    const asset = await assetsClient.getAsset(assetId);
    const ownsBrand = await ensureBrandOwned(asset.brandId, userId);
    if (!ownsBrand) {
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

      const ownsBrand = await ensureBrandOwned(brandId, userId);
      if (!ownsBrand) {
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
        tags?: string[];
        folderId?: string;
      };

      if (!body.brandId || !body.fileName || !body.s3Key || !body.mimeType || !body.fileType) {
        return reply.code(400).send({ error: 'Missing required fields' });
      }

      const ownsBrand = await ensureBrandOwned(body.brandId, userId);
      if (!ownsBrand) {
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
      folderId?: string;
      tags?: string[];
      excludeTags?: string[];
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
      usageStatuses?: Array<'used' | 'unused'>;
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
        folderId,
        aspectRatio,
        aspectRatios,
        orientationTypes,
        minWidth,
        maxWidth,
        minHeight,
        maxHeight,
        uploadedAfter,
        uploadedBefore,
        usageStatuses,
      } = request.query;
      const tags = request.query.tags;
      const excludeTags = request.query.excludeTags;

      if (!brandId) {
        return reply.code(400).send({ error: 'brandId is required' });
      }

      const ownsBrand = await ensureBrandOwned(brandId, userId);
      if (!ownsBrand) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      const result: ListAssetsResponse = await assetsClient.listAssets({
        brandId,
        type,
        search,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        folderId: folderId || undefined,
        tags,
        excludeTags,
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
        usageStatuses,
      });

      return reply.send(result);
    } catch (error) {
      request.log.error(formatError(error), 'Failed to proxy assets list');
      return reply.code(500).send({ error: 'Failed to fetch assets' });
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

      const ownsBrand = await ensureBrandOwned(brandId, userId);
      if (!ownsBrand) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      const usage = await prisma.postMediaAsset.groupBy({
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
