import { prismaAssets } from '@postolio/database-assets';
import { generateUploadUrl, getAssetUrl, assetsBucketName } from '../utils/s3.js';
const assetsRoutes = async (fastify) => {
  // Get presigned URL for upload
  fastify.post(
    '/assets/upload-url',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const body = request.body;
      try {
        const { brandId, fileName, contentType, fileType } = body;
        // Validate required fields
        if (!brandId || !fileName || !contentType || !fileType) {
          return reply.code(400).send({ error: 'Missing required fields' });
        }
        // Generate presigned URL
        const uploadData = await generateUploadUrl({
          brandId,
          fileName,
          contentType,
          fileType,
        });
        return {
          ...uploadData,
          message: 'Upload URL generated successfully',
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({
          error: error instanceof Error ? error.message : 'Failed to generate upload URL',
        });
      }
    }
  );
  // Create asset metadata after upload
  fastify.post('/assets', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user;
    const body = request.body;
    try {
      const asset = await prismaAssets.asset.create({
        data: {
          brandId: body.brandId,
          uploadedBy: user.userId,
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
    const query = request.query;
    try {
      const page = parseInt(query.page || '1', 10);
      const limit = Math.min(parseInt(query.limit || '50', 10), 100);
      const skip = (page - 1) * limit;
      // Build where clause
      const where = {};
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
    const { id } = request.params;
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
    const { id } = request.params;
    const body = request.body;
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
    const { id } = request.params;
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
