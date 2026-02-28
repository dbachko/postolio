import type { FastifyInstance } from 'fastify';
import type { AssetRecord, BulkAssetAction, DeleteAssetResponse } from '@postolio/assets-client';

import { formatError } from '../../utils/logging.js';
import { assetsClient, ensureAssetOwned, ensureBrandOwned, prisma } from './shared.js';

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))
  );
}

export function registerUploadUrlRoute(fastify: FastifyInstance): void {
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
}

export function registerCreateAssetRoute(fastify: FastifyInstance): void {
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

      const { owns } = await ensureBrandOwned(body.brandId, userId);
      if (!owns) {
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
}

export function registerBulkAssetsRoute(fastify: FastifyInstance): void {
  fastify.post('/bulk', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const body = request.body as { brandId: string; assetIds: string[]; action: BulkAssetAction };
      if (!body.brandId || !Array.isArray(body.assetIds) || body.assetIds.length === 0) {
        return reply.code(400).send({ error: 'brandId and assetIds are required' });
      }

      const { owns } = await ensureBrandOwned(body.brandId, userId);
      if (!owns) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      const result = await assetsClient.bulkAssets(body);
      return reply.send(result);
    } catch (error) {
      request.log.error(formatError(error), 'Failed to perform bulk asset action');
      return reply.code(500).send({ error: 'Failed to perform bulk asset action' });
    }
  });
}

export function registerUsageRoute(fastify: FastifyInstance): void {
  fastify.post<{ Body: { assetIds?: string[]; brandId?: string } }>(
    '/usage',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const normalizedIds = normalizeStringArray(request.body.assetIds);
        const brandId = request.body.brandId;
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
          where: { assetId: { in: normalizedIds }, content: { brandId } },
        });
        const counts = new Map(usage.map((row) => [row.assetId, row._count._all ?? 0]));
        const results = normalizedIds.map((assetId) => {
          const postCount = counts.get(assetId) ?? 0;
          return { assetId, usedInPosts: postCount > 0, postCount };
        });
        return reply.send({ usage: results });
      } catch (error) {
        request.log.error(formatError(error), 'Failed to check asset usage');
        return reply.code(500).send({ error: 'Failed to check asset usage' });
      }
    }
  );
}

export function registerBatchRoute(fastify: FastifyInstance): void {
  fastify.post<{ Body: { assetIds?: string[] } }>(
    '/batch',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const normalizedIds = normalizeStringArray(request.body.assetIds);
        if (normalizedIds.length === 0) {
          return reply.code(400).send({ error: 'assetIds is required' });
        }

        const assets = await assetsClient.getBatchAssets(normalizedIds);
        const presentAssets = assets.filter(Boolean) as AssetRecord[];
        const uniqueBrandIds = Array.from(new Set(presentAssets.map((asset) => asset.brandId)));

        const ownedBrandIds = new Set<string>();
        for (const brandId of uniqueBrandIds) {
          const { owns } = await ensureBrandOwned(brandId, userId);
          if (owns) {
            ownedBrandIds.add(brandId);
          }
        }

        const assetsById: Record<string, AssetRecord | null> = {};
        normalizedIds.forEach((assetId, idx) => {
          const asset = assets[idx] ?? null;
          assetsById[assetId] = asset && ownedBrandIds.has(asset.brandId) ? asset : null;
        });
        return reply.send({ assets: assetsById });
      } catch (error) {
        request.log.error(formatError(error), 'Failed to batch fetch assets');
        return reply.code(500).send({ error: 'Failed to fetch assets' });
      }
    }
  );
}

export function registerGetAssetRoute(fastify: FastifyInstance): void {
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
}

export function registerUpdateAssetRoute(fastify: FastifyInstance): void {
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
}

export function registerDeleteAssetRoute(fastify: FastifyInstance): void {
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
}
