import type { FastifyPluginAsync } from 'fastify';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import {
  normalizeAssetLabelName,
  prismaAssets,
  type Prisma as AssetsPrisma,
} from '@postolio/database-assets';
import sharp from 'sharp';
import { customAlphabet } from 'nanoid';
import {
  generateUploadUrl,
  getAssetUrl,
  assetsBucketName,
  s3Client,
  deleteS3Objects,
} from '../utils/s3.js';

const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10);
const UNSORTED_COLLECTION_FILTER = 'unsorted';

const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function guessExtension(mimeType: string, fallback = 'bin'): string {
  return MIME_EXTENSION_MAP[mimeType.toLowerCase()] || fallback;
}

async function fetchBufferFromUrl(
  url: string
): Promise<{ buffer: Buffer; fileName: string; mimeType?: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch source asset: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const parsedUrl = new URL(url);
  const path = parsedUrl.pathname.split('/').pop() || `asset-${nanoid()}`;
  return { buffer, fileName: path, mimeType: response.headers.get('content-type') || undefined };
}

const assetsRoutes: FastifyPluginAsync = async (fastify) => {
  // Get presigned URL for upload
  fastify.post(
    '/assets/upload-url',
    { preHandler: [fastify.authenticateService] },
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
  fastify.post('/assets', { preHandler: [fastify.authenticateService] }, async (request, reply) => {
    const body = request.body as {
      brandId: string;
      fileName: string;
      s3Key: string;
      fileSize: number;
      mimeType: string;
      fileType: 'image' | 'video';
      uploadedBy?: string;
      width?: number;
      height?: number;
      duration?: number;
      title?: string;
      altText?: string;
      description?: string;
      collectionId?: string | null;
      labelIds?: string[];
    };

    try {
      let resolvedCollectionId: string | undefined | null = body.collectionId ?? undefined;
      if (body.collectionId) {
        const collection = await prismaAssets.assetTaxonomyItem.findUnique({
          where: { id: body.collectionId },
          select: { id: true, brandId: true, type: true },
        });
        if (
          !collection ||
          collection.brandId !== body.brandId ||
          collection.type !== 'COLLECTION'
        ) {
          return reply.code(400).send({ error: 'Invalid collection selection for brand' });
        }
        resolvedCollectionId = collection.id;
      }

      const asset = await prismaAssets.asset.create({
        data: {
          brandId: body.brandId,
          uploadedBy: body.uploadedBy || 'system',
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
          description: body.description,
          collectionId: resolvedCollectionId ?? undefined,
          processingStatus: 'pending',
        },
      });

      const labelIds = body.labelIds && body.labelIds.length > 0 ? body.labelIds : [];
      if (labelIds.length > 0) {
        await prismaAssets.assetTaxonomyAssignment.createMany({
          data: labelIds.map((taxonomyItemId) => ({
            assetId: asset.id,
            taxonomyItemId,
            createdBy: body.uploadedBy || 'system',
          })),
          skipDuplicates: true,
        });
      }

      return {
        asset: {
          ...asset,
          labelIds,
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
  fastify.get('/assets', { preHandler: [fastify.authenticateService] }, async (request, reply) => {
    const query = request.query as {
      brandId?: string;
      type?: 'image' | 'video';
      search?: string;
      page?: string;
      limit?: string;
      collectionId?: string;
      includeSubcollections?: string;
      labelIds?: string | string[];
      labelMode?: 'any' | 'all';

      // New filters for aspect ratio and dimensions
      aspectRatio?: string;
      aspectRatios?: string | string[];
      orientationType?: 'portrait' | 'landscape' | 'square';
      orientationTypes?: string | string[];
      minWidth?: string;
      maxWidth?: string;
      minHeight?: string;
      maxHeight?: string;

      // Date filters
      uploadedAfter?: string;
      uploadedBefore?: string;

      // Usage filter
      usage?: 'used' | 'unused' | 'any';
    };

    try {
      const page = parseInt(query.page || '1', 10);
      const limit = Math.min(parseInt(query.limit || '50', 10), 100);
      const skip = (page - 1) * limit;

      // Build where clause
      const where: AssetsPrisma.AssetWhereInput = {};

      if (!query.brandId) {
        return reply.code(400).send({ error: 'brandId is required' });
      }
      where.brandId = query.brandId;

      if (query.type) {
        where.fileType = query.type;
      }
      where.archivedAt = null;

      if (query.collectionId) {
        if (query.collectionId === UNSORTED_COLLECTION_FILTER) {
          where.collectionId = null;
        } else {
          const includeSub =
            query.includeSubcollections === 'true' || query.includeSubcollections === '1';
          const collectionIds = includeSub
            ? (
                await prismaAssets.$queryRaw<Array<{ id: string }>>`
              WITH RECURSIVE subcollections AS (
                SELECT "id"
                FROM "asset_taxonomy_items"
                WHERE "id" = ${query.collectionId}
                  AND "brandId" = ${query.brandId}
                  AND "type" = 'COLLECTION'
                  AND "deletedAt" IS NULL
                UNION ALL
                SELECT c."id"
                FROM "asset_taxonomy_items" c
                JOIN subcollections s ON c."parentId" = s."id"
                WHERE c."brandId" = ${query.brandId}
                  AND c."type" = 'COLLECTION'
                  AND c."deletedAt" IS NULL
              )
              SELECT "id" FROM subcollections;
            `
              ).map((row) => row.id)
            : [query.collectionId];

          if (collectionIds.length === 0) {
            return {
              assets: [],
              pagination: {
                total: 0,
                page,
                limit,
                totalPages: 0,
              },
            };
          }
          where.collectionId = { in: collectionIds };
        }
      }

      const labelIds = query.labelIds
        ? Array.isArray(query.labelIds)
          ? query.labelIds
          : [query.labelIds]
        : [];
      if (labelIds.length > 0) {
        const mode = query.labelMode === 'all' ? 'all' : 'any';
        if (mode === 'any') {
          where.labelAssignments = {
            some: { taxonomyItemId: { in: labelIds } },
          };
        } else {
          const andConditions: AssetsPrisma.AssetWhereInput[] = [];
          if (where.AND) {
            if (Array.isArray(where.AND)) {
              andConditions.push(...where.AND);
            } else {
              andConditions.push(where.AND);
            }
          }
          labelIds.forEach((id) => {
            andConditions.push({
              labelAssignments: { some: { taxonomyItemId: id } },
            });
          });
          where.AND = andConditions;
        }
      }

      if (query.search) {
        where.OR = [
          { title: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
          { fileName: { contains: query.search, mode: 'insensitive' } },
        ];
      }

      // Aspect ratio filters
      if (query.aspectRatio) {
        where.aspectRatio = query.aspectRatio;
      }

      if (query.aspectRatios) {
        const ratios = Array.isArray(query.aspectRatios)
          ? query.aspectRatios
          : [query.aspectRatios];
        where.aspectRatio = { in: ratios };
      }

      if (query.orientationTypes) {
        const orientations = Array.isArray(query.orientationTypes)
          ? query.orientationTypes
          : [query.orientationTypes];
        if (orientations.length > 0) {
          where.orientationType = { in: orientations };
        }
      } else if (query.orientationType) {
        where.orientationType = query.orientationType;
      }

      // Dimension filters - only apply to assets with dimensions
      if (query.minWidth || query.maxWidth) {
        const andConditions: AssetsPrisma.AssetWhereInput[] = [];
        if (where.AND) {
          if (Array.isArray(where.AND)) {
            andConditions.push(...where.AND);
          } else {
            andConditions.push(where.AND);
          }
        }
        andConditions.push({ width: { not: null } });
        where.AND = andConditions;

        where.width = {
          ...(query.minWidth && { gte: parseInt(query.minWidth, 10) }),
          ...(query.maxWidth && { lte: parseInt(query.maxWidth, 10) }),
        };
      }

      if (query.minHeight || query.maxHeight) {
        const andConditions: AssetsPrisma.AssetWhereInput[] = [];
        if (where.AND) {
          if (Array.isArray(where.AND)) {
            andConditions.push(...where.AND);
          } else {
            andConditions.push(where.AND);
          }
        }
        andConditions.push({ height: { not: null } });
        where.AND = andConditions;

        where.height = {
          ...(query.minHeight && { gte: parseInt(query.minHeight, 10) }),
          ...(query.maxHeight && { lte: parseInt(query.maxHeight, 10) }),
        };
      }

      // Date filters with validation
      if (query.uploadedAfter || query.uploadedBefore) {
        const parseDate = (dateStr: string): Date | null => {
          try {
            const date = new Date(dateStr);
            return isNaN(date.getTime()) ? null : date;
          } catch {
            return null;
          }
        };

        const after = query.uploadedAfter ? parseDate(query.uploadedAfter) : null;
        const before = query.uploadedBefore ? parseDate(query.uploadedBefore) : null;

        if (query.uploadedAfter && !after) {
          return reply.code(400).send({ error: 'Invalid uploadedAfter date format' });
        }
        if (query.uploadedBefore && !before) {
          return reply.code(400).send({ error: 'Invalid uploadedBefore date format' });
        }

        where.createdAt = {
          ...(after && { gte: after }),
          ...(before && { lte: before }),
        };
      }

      // Usage status filter
      if (query.usage === 'used') {
        where.usageCount = { gt: 0 };
      } else if (query.usage === 'unused') {
        where.usageCount = 0;
      }

      // Fetch assets with pagination
      const [assets, total] = await Promise.all([
        prismaAssets.asset.findMany({
          where,
          include: {
            labelAssignments: {
              select: { taxonomyItemId: true },
            },
          },
          orderBy: { updatedAt: 'desc' },
          skip,
          take: limit,
        }),
        prismaAssets.asset.count({ where }),
      ]);

      // Add URLs to assets
      const assetsWithUrls = assets.map((asset) => {
        const { labelAssignments = [], ...rest } = asset;
        const labelIds = labelAssignments.map((assignment) => assignment.taxonomyItemId);
        return {
          ...rest,
          labelIds,
          url: getAssetUrl(asset.s3Key),
          thumbnailUrl: asset.thumbnailKey ? getAssetUrl(asset.thumbnailKey) : null,
        };
      });

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

  // Get available aspect ratios for a brand
  fastify.get(
    '/assets/aspect-ratios',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => {
      const query = request.query as { brandId?: string };

      if (!query.brandId) {
        return reply.code(400).send({ error: 'brandId is required' });
      }

      try {
        // Get distinct aspect ratios used in this brand's assets
        const results = await prismaAssets.asset.groupBy({
          by: ['aspectRatio', 'orientationType'],
          where: {
            brandId: query.brandId,
            aspectRatio: { not: null },
            archivedAt: null,
          },
          _count: {
            id: true,
          },
        });

        // Transform and sort by count
        const aspectRatios = results
          .map((r) => ({
            aspectRatio: r.aspectRatio,
            orientationType: r.orientationType,
            count: r._count.id,
          }))
          .sort((a, b) => b.count - a.count);

        // Standard aspect ratios for quick reference
        const commonRatios = [
          { label: '1:1 — Square', value: '1:1', platform: 'Instagram Post, Facebook' },
          { label: '4:5 — Portrait', value: '4:5', platform: 'Instagram Feed' },
          { label: '9:16 — Full vertical', value: '9:16', platform: 'Stories, Reels, TikTok' },
          { label: '3:4 — Tall classic', value: '3:4', platform: 'Pinterest, Portrait' },
          { label: '4:3 — Photo classic', value: '4:3', platform: 'Traditional Photo' },
          { label: '16:9 — Standard landscape', value: '16:9', platform: 'YouTube, Twitter/X' },
          { label: '1.91:1 — Social ads landscape', value: '1.91:1', platform: 'Facebook Ads' },
          { label: '2:1 — Ultra-wide', value: '2:1', platform: 'Ultra-wide displays' },
          { label: '2.39:1 — Cinematic wide', value: '2.39:1', platform: 'Cinematic films' },
        ];

        return {
          aspectRatios,
          common: commonRatios,
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({
          error: error instanceof Error ? error.message : 'Failed to fetch aspect ratios',
        });
      }
    }
  );

  // Get single asset
  fastify.get(
    '/assets/:id',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      try {
        const asset = await prismaAssets.asset.findUnique({
          where: { id },
          include: {
            labelAssignments: { select: { taxonomyItemId: true } },
          },
        });

        if (!asset) {
          return reply.code(404).send({ error: 'Asset not found' });
        }

        const { labelAssignments = [], ...rest } = asset;
        const labelIds = labelAssignments.map((assignment) => assignment.taxonomyItemId);

        return {
          asset: {
            ...rest,
            labelIds,
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
    }
  );

  // Get multiple assets by IDs (batch)
  fastify.post(
    '/assets/batch',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => {
      const body = request.body as { assetIds: string[] };

      try {
        // Validate input
        if (!body.assetIds || !Array.isArray(body.assetIds)) {
          return reply.code(400).send({ error: 'assetIds must be an array' });
        }

        if (body.assetIds.length === 0) {
          return { assets: [] };
        }

        // Limit batch size to prevent abuse
        if (body.assetIds.length > 50) {
          return reply.code(400).send({ error: 'Maximum 50 assets per batch request' });
        }

        // Fetch all assets in a single query
        const assets = await prismaAssets.asset.findMany({
          where: {
            id: { in: body.assetIds },
            archivedAt: null,
          },
          include: {
            labelAssignments: { select: { taxonomyItemId: true } },
          },
        });

        // Map to include CDN URLs and maintain order
        const assetMap = new Map(
          assets.map((asset) => {
            const { labelAssignments = [], ...rest } = asset;
            const labelIds = labelAssignments.map((assignment) => assignment.taxonomyItemId);
            return [
              asset.id,
              {
                ...rest,
                labelIds,
                url: getAssetUrl(asset.s3Key),
                thumbnailUrl: asset.thumbnailKey ? getAssetUrl(asset.thumbnailKey) : null,
              },
            ];
          })
        );

        // Return assets in the same order as requested, with null for missing
        const orderedAssets = body.assetIds.map((id) => assetMap.get(id) || null);

        return { assets: orderedAssets };
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({
          error: error instanceof Error ? error.message : 'Failed to fetch assets',
        });
      }
    }
  );

  // Update asset metadata
  fastify.patch(
    '/assets/:id',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        title?: string;
        altText?: string;
        description?: string;
        collectionId?: string | null;
        labelIds?: string[];
      };

      try {
        let resolvedCollectionId: string | null | undefined = body.collectionId ?? undefined;
        if (body.collectionId) {
          const collection = await prismaAssets.assetTaxonomyItem.findUnique({
            where: { id: body.collectionId },
            select: { id: true, brandId: true, type: true },
          });
          if (collection?.type !== 'COLLECTION') {
            return reply.code(400).send({ error: 'Invalid collection selection' });
          }
          resolvedCollectionId = collection.id;
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

        if (body.labelIds) {
          await prismaAssets.$transaction([
            prismaAssets.assetTaxonomyAssignment.deleteMany({ where: { assetId: id } }),
            ...(body.labelIds.length > 0
              ? [
                  prismaAssets.assetTaxonomyAssignment.createMany({
                    data: body.labelIds.map((taxonomyItemId) => ({
                      assetId: id,
                      taxonomyItemId,
                      createdBy: 'system',
                    })),
                    skipDuplicates: true,
                  }),
                ]
              : []),
          ]);
        }

        const labelAssignments = await prismaAssets.assetTaxonomyAssignment.findMany({
          where: { assetId: id },
          select: { taxonomyItemId: true },
        });
        const labelIds = labelAssignments.map((assignment) => assignment.taxonomyItemId);

        return {
          asset: {
            ...asset,
            labelIds,
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
    }
  );

  // Bulk asset actions
  fastify.post(
    '/assets/bulk',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => {
      const body = request.body as {
        assetIds: string[];
        brandId?: string;
        action:
          | { move_to_collection: { collectionId?: string | null } }
          | { add_labels: { labelIds?: string[]; labelNames?: string[]; createdBy?: string } }
          | { remove_labels: { labelIds: string[] } }
          | { delete: Record<string, never> };
      };

      const assetIds = Array.isArray(body.assetIds)
        ? Array.from(new Set(body.assetIds.filter((id) => typeof id === 'string' && id.length > 0)))
        : [];

      if (assetIds.length === 0) {
        return reply.code(400).send({ error: 'assetIds are required' });
      }

      const action = body.action;
      if (!action || typeof action !== 'object') {
        return reply.code(400).send({ error: 'action is required' });
      }

      if ('move_to_collection' in action) {
        const collectionId = action.move_to_collection?.collectionId ?? null;
        if (collectionId) {
          const collection = await prismaAssets.assetTaxonomyItem.findUnique({
            where: { id: collectionId },
            select: { id: true, brandId: true, type: true },
          });
          if (
            collection?.type !== 'COLLECTION' ||
            (body.brandId && collection.brandId !== body.brandId)
          ) {
            return reply.code(400).send({ error: 'Invalid collection selection' });
          }
        }

        await prismaAssets.asset.updateMany({
          where: { id: { in: assetIds } },
          data: { collectionId: collectionId ?? null },
        });

        return { success: true };
      }

      if ('add_labels' in action) {
        const labelIds = new Set<string>();
        const createdBy = action.add_labels.createdBy ?? 'system';

        if (action.add_labels.labelIds) {
          action.add_labels.labelIds.forEach((id) => {
            if (id) {
              labelIds.add(id);
            }
          });
        }

        if (action.add_labels.labelNames && action.add_labels.labelNames.length > 0) {
          if (!body.brandId) {
            return reply.code(400).send({ error: 'brandId is required to create labels' });
          }
          const normalized = action.add_labels.labelNames
            .map((name) => name?.trim())
            .filter((name): name is string => !!name)
            .map((name) => ({ name, nameNorm: normalizeAssetLabelName(name) }));

          if (normalized.length > 0) {
            const existing = await prismaAssets.assetTaxonomyItem.findMany({
              where: {
                brandId: body.brandId,
                type: 'LABEL',
                nameNorm: { in: normalized.map((item) => item.nameNorm) },
                deletedAt: null,
              },
              select: { id: true, nameNorm: true },
            });
            const existingByNorm = new Map(existing.map((item) => [item.nameNorm, item.id]));

            const toCreate = normalized.filter((item) => !existingByNorm.has(item.nameNorm));
            if (toCreate.length > 0) {
              await prismaAssets.assetTaxonomyItem.createMany({
                data: toCreate.map((item) => ({
                  brandId: body.brandId!,
                  type: 'LABEL',
                  name: item.name,
                  nameNorm: item.nameNorm,
                  createdBy,
                })),
                skipDuplicates: true,
              });
            }

            const updated = await prismaAssets.assetTaxonomyItem.findMany({
              where: {
                brandId: body.brandId,
                type: 'LABEL',
                nameNorm: { in: normalized.map((item) => item.nameNorm) },
                deletedAt: null,
              },
              select: { id: true },
            });
            updated.forEach((item) => labelIds.add(item.id));
          }
        }

        const labelsToAssign = Array.from(labelIds);
        if (labelsToAssign.length === 0) {
          return { success: true };
        }

        const assignments = assetIds.flatMap((assetId) =>
          labelsToAssign.map((taxonomyItemId) => ({
            assetId,
            taxonomyItemId,
            createdBy,
          }))
        );

        await prismaAssets.assetTaxonomyAssignment.createMany({
          data: assignments,
          skipDuplicates: true,
        });

        return { success: true };
      }

      if ('remove_labels' in action) {
        const labelIds = action.remove_labels.labelIds ?? [];
        if (labelIds.length === 0) {
          return { success: true };
        }
        await prismaAssets.assetTaxonomyAssignment.deleteMany({
          where: {
            assetId: { in: assetIds },
            taxonomyItemId: { in: labelIds },
          },
        });
        return { success: true };
      }

      if ('delete' in action) {
        const where: AssetsPrisma.AssetWhereInput = {
          id: { in: assetIds },
          ...(body.brandId ? { brandId: body.brandId } : {}),
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
          [
            asset.s3Key,
            asset.thumbnailKey,
            asset.thumbnailSmallKey,
            asset.thumbnailLargeKey,
          ].filter((key): key is string => !!key)
        );

        await deleteS3Objects(storageKeys);

        await prismaAssets.asset.deleteMany({
          where: { id: { in: assetsToDelete.map((asset) => asset.id) } },
        });
        return { success: true };
      }

      return reply.code(400).send({ error: 'Unsupported action' });
    }
  );

  // Delete asset permanently (DB row + S3 objects)
  fastify.delete(
    '/assets/:id',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => {
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

        await prismaAssets.asset.delete({
          where: { id: asset.id },
        });

        return {
          success: true,
          message: 'Asset deleted permanently',
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({
          error: error instanceof Error ? error.message : 'Failed to delete asset',
        });
      }
    }
  );

  fastify.post(
    '/assets/import',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => {
      const body = request.body as {
        brandId: string;
        uploadedBy?: string;
        sourceUrl?: string;
        dataBase64?: string;
        fileName?: string;
        mimeType?: string;
        fileType?: 'image' | 'video';
        title?: string;
        altText?: string;
        description?: string;
        labelIds?: string[];
        collectionId?: string;
        publishedAt?: string;
      };

      if (!body.brandId) {
        return reply.code(400).send({ error: 'brandId is required' });
      }

      if (!body.sourceUrl && !body.dataBase64) {
        return reply.code(400).send({ error: 'sourceUrl or dataBase64 is required' });
      }

      if (body.dataBase64 && !body.mimeType) {
        return reply.code(400).send({ error: 'mimeType is required when sending base64 data' });
      }

      try {
        let buffer: Buffer;
        let derivedFileName = body.fileName;
        let derivedMimeType = body.mimeType;

        if (body.sourceUrl) {
          const result = await fetchBufferFromUrl(body.sourceUrl);
          buffer = result.buffer;
          derivedFileName = derivedFileName || result.fileName;
          derivedMimeType = derivedMimeType || result.mimeType;
        } else {
          const base64Source = body.dataBase64!;
          const base64Data = base64Source.startsWith('data:')
            ? base64Source.slice(base64Source.indexOf(',') + 1)
            : base64Source;
          buffer = Buffer.from(base64Data, 'base64');
        }

        if (!derivedMimeType) {
          throw new Error('Unable to determine MIME type for imported asset');
        }

        if (!derivedFileName) {
          const ext = guessExtension(derivedMimeType, 'bin');
          derivedFileName = `asset-${nanoid()}.${ext}`;
        }

        const fileType =
          body.fileType ||
          (derivedMimeType.startsWith('image/')
            ? 'image'
            : derivedMimeType.startsWith('video/')
              ? 'video'
              : undefined);

        if (!fileType) {
          throw new Error('Unsupported MIME type for asset import');
        }

        const timestamp = Date.now();
        const sanitized = sanitizeFileName(derivedFileName);
        const s3Key = `brands/${body.brandId}/imports/${timestamp}_${nanoid()}_${sanitized}`;

        await s3Client.send(
          new PutObjectCommand({
            Bucket: assetsBucketName,
            Key: s3Key,
            Body: buffer,
            ContentType: derivedMimeType,
          })
        );

        let width: number | undefined;
        let height: number | undefined;
        let aspectRatio: string | undefined;
        let aspectRatioDecimal: number | undefined;
        let orientationType: string | undefined;

        if (fileType === 'image') {
          const metadata = await sharp(buffer).metadata();
          width = metadata.width ?? undefined;
          height = metadata.height ?? undefined;

          // Calculate aspect ratio if dimensions are available with standardized matching
          if (width && height) {
            aspectRatioDecimal = width / height;
            const tolerance = 0.03; // 3% tolerance for matching to standard ratios

            // Standard ratios (same as in aspect-ratio.ts utility)
            const standardRatios = [
              { label: '1:1', decimal: 1.0 },
              { label: '4:5', decimal: 0.8 },
              { label: '9:16', decimal: 0.5625 },
              { label: '3:4', decimal: 0.75 },
              { label: '4:3', decimal: 1.3333 },
              { label: '16:9', decimal: 1.7778 },
              { label: '1.91:1', decimal: 1.91 },
              { label: '2:1', decimal: 2.0 },
              { label: '2.39:1', decimal: 2.39 },
            ];

            // Try to match to a standard ratio
            aspectRatio = 'CUSTOM';
            for (const standard of standardRatios) {
              if (Math.abs(aspectRatioDecimal - standard.decimal) <= tolerance) {
                aspectRatio = standard.label;
                break;
              }
            }

            // Determine orientation
            if (Math.abs(aspectRatioDecimal - 1.0) < 0.01) {
              orientationType = 'square';
            } else {
              orientationType = aspectRatioDecimal < 1 ? 'portrait' : 'landscape';
            }
          }
        }

        let resolvedCollectionId: string | undefined;
        if (body.collectionId) {
          const collection = await prismaAssets.assetTaxonomyItem.findUnique({
            where: { id: body.collectionId },
            select: { id: true, brandId: true, type: true },
          });
          if (
            !collection ||
            collection.brandId !== body.brandId ||
            collection.type !== 'COLLECTION'
          ) {
            return reply.code(400).send({ error: 'Invalid collection selection for brand' });
          }
          resolvedCollectionId = collection.id;
        }

        const asset = await prismaAssets.asset.create({
          data: {
            brandId: body.brandId,
            uploadedBy: body.uploadedBy || 'system',
            fileName: derivedFileName,
            s3Key,
            s3Bucket: assetsBucketName,
            fileSize: buffer.byteLength,
            mimeType: derivedMimeType,
            fileType,
            width,
            height,
            aspectRatio,
            aspectRatioDecimal,
            orientationType,
            title: body.title,
            altText: body.altText,
            description: body.description,
            processingStatus: 'pending',
            collectionId: resolvedCollectionId,
          },
        });

        if (body.labelIds && body.labelIds.length > 0) {
          await prismaAssets.assetTaxonomyAssignment.createMany({
            data: body.labelIds.map((taxonomyItemId) => ({
              assetId: asset.id,
              taxonomyItemId,
              createdBy: body.uploadedBy || 'system',
            })),
            skipDuplicates: true,
          });
        }

        if (body.publishedAt) {
          const publishedDate = new Date(body.publishedAt);
          if (!Number.isNaN(publishedDate.getTime())) {
            await prismaAssets.$executeRaw`
              UPDATE "assets"
              SET "updatedAt" = ${publishedDate}
              WHERE "id" = ${asset.id}
            `;
            asset.updatedAt = publishedDate;
          }
        }

        return {
          asset: {
            ...asset,
            labelIds: body.labelIds || [],
            url: getAssetUrl(asset.s3Key),
          },
          message: 'Asset imported successfully',
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({
          error: error instanceof Error ? error.message : 'Failed to import asset',
        });
      }
    }
  );

  fastify.get(
    '/assets/:id/ownership',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const query = request.query as { brandId?: string };

      if (!query.brandId) {
        return reply.code(400).send({ error: 'brandId query parameter is required' });
      }

      try {
        const asset = await prismaAssets.asset.findUnique({
          where: { id },
        });

        if (!asset) {
          return reply.code(404).send({ error: 'Asset not found' });
        }

        const ownsAsset = asset.brandId === query.brandId;
        return {
          valid: ownsAsset,
          asset: ownsAsset
            ? {
                ...asset,
                url: getAssetUrl(asset.s3Key),
              }
            : null,
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({
          error: error instanceof Error ? error.message : 'Failed to verify asset ownership',
        });
      }
    }
  );
};

export default assetsRoutes;
