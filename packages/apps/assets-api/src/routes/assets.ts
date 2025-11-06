import { FastifyPluginAsync } from 'fastify';
import { prismaAssets } from '@postolio/database-assets';
import { generateUploadUrl, getAssetUrl, assetsBucketName } from '../utils/s3.js';

const assetsRoutes: FastifyPluginAsync = async (fastify) => {
  // Get presigned URL for upload
  fastify.post(
    '/assets/upload-url',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const body = request.body as {
        brandId: string;
        fileName: string;
        contentType: string;
        fileType: 'image' | 'video';
        fileSize: number;
      };

      try {
        const { brandId, fileName, contentType, fileType, fileSize } = body;

        // Validate required fields
        if (!brandId || !fileName || !contentType || !fileType || fileSize == null) {
          return reply.code(400).send({ error: 'Missing required fields' });
        }
        if (typeof fileSize !== 'number' || Number.isNaN(fileSize) || fileSize <= 0) {
          return reply.code(400).send({ error: 'Invalid file size' });
        }

        // Generate presigned URL
        const uploadData = await generateUploadUrl({
          brandId,
          fileName,
          contentType,
          fileType,
          fileSize,
        });

        return {
          ...uploadData,
          message: 'Upload URL generated successfully',
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to generate upload URL';
        const isBadRequest =
          error instanceof Error &&
          (message.toLowerCase().includes('invalid') || message.toLowerCase().includes('exceeds'));
        if (!isBadRequest) {
          fastify.log.error(error);
        } else {
          fastify.log.warn(error);
        }
        return reply.code(isBadRequest ? 400 : 500).send({
          error: message,
        });
      }
    }
  );

  // Create asset metadata after upload
  fastify.post('/assets', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { userId?: string; id?: string } | undefined;
    const userId = authUser?.userId || authUser?.id;
    if (!userId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
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

    try {
      const asset = await prismaAssets.asset.create({
        data: {
          brandId: body.brandId,
          uploadedBy: userId,
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
          tags: body.tags || [],
          folderId: body.folderId,
          processingStatus: 'pending',
        },
      });

      return {
        asset: {
          ...asset,
          url: getAssetUrl(asset.s3Key),
        },
        message: 'Asset created successfully',
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({
        error: error instanceof Error ? error.message : 'Failed to create asset',
      });
    }
  });

  // List assets
  fastify.get('/assets', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const query = request.query as {
      brandId?: string;
      type?: 'image' | 'video';
      tags?: string | string[];
      search?: string;
      page?: string;
      limit?: string;
      folderId?: string;
    };

    try {
      const page = parseInt(query.page || '1', 10);
      const limit = Math.min(parseInt(query.limit || '50', 10), 100);
      const skip = (page - 1) * limit;

      // Build where clause
      const where: Record<string, unknown> = {};

      if (query.brandId) {
        where.brandId = query.brandId;
      }

      if (query.type) {
        where.fileType = query.type;
      }

      if (query.tags) {
        const tagArray = Array.isArray(query.tags) ? query.tags : [query.tags];
        where.tags = { hasSome: tagArray };
      }

      if (query.folderId) {
        where.folderId = query.folderId;
      }

      if (query.search) {
        where.OR = [
          { title: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
          { fileName: { contains: query.search, mode: 'insensitive' } },
        ];
      }

      // Fetch assets with pagination
      const [assets, total] = await Promise.all([
        prismaAssets.asset.findMany({
          where,
          include: {
            folder: true,
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prismaAssets.asset.count({ where }),
      ]);

      // Add URLs to assets
      const assetsWithUrls = assets.map((asset) => ({
        ...asset,
        url: getAssetUrl(asset.s3Key),
        thumbnailUrl: asset.thumbnailKey ? getAssetUrl(asset.thumbnailKey) : null,
      }));

      return {
        assets: assetsWithUrls,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({
        error: error instanceof Error ? error.message : 'Failed to fetch assets',
      });
    }
  });

  // Get single asset
  fastify.get('/assets/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const asset = await prismaAssets.asset.findUnique({
        where: { id },
        include: {
          folder: true,
          campaignAssets: true,
        },
      });

      if (!asset) {
        return reply.code(404).send({ error: 'Asset not found' });
      }

      return {
        asset: {
          ...asset,
          url: getAssetUrl(asset.s3Key),
          thumbnailUrl: asset.thumbnailKey ? getAssetUrl(asset.thumbnailKey) : null,
        },
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({
        error: error instanceof Error ? error.message : 'Failed to fetch asset',
      });
    }
  });

  // Update asset metadata
  fastify.patch('/assets/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      title?: string;
      altText?: string;
      description?: string;
      tags?: string[];
      folderId?: string | null;
    };

    try {
      const asset = await prismaAssets.asset.update({
        where: { id },
        data: {
          title: body.title,
          altText: body.altText,
          description: body.description,
          tags: body.tags,
          folderId: body.folderId,
        },
      });

      return {
        asset: {
          ...asset,
          url: getAssetUrl(asset.s3Key),
        },
        message: 'Asset updated successfully',
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({
        error: error instanceof Error ? error.message : 'Failed to update asset',
      });
    }
  });

  // Delete asset (soft delete via archiving)
  fastify.delete('/assets/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      await prismaAssets.asset.update({
        where: { id },
        data: {
          archivedAt: new Date(),
        },
      });

      return {
        success: true,
        message: 'Asset archived successfully',
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({
        error: error instanceof Error ? error.message : 'Failed to delete asset',
      });
    }
  });
};

export default assetsRoutes;
