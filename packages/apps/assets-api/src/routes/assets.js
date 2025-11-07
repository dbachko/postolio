import { PutObjectCommand } from '@aws-sdk/client-s3';
import { prismaAssets } from '@postolio/database-assets';
import sharp from 'sharp';
import { customAlphabet } from 'nanoid';
import { generateUploadUrl, getAssetUrl, assetsBucketName, s3Client } from '../utils/s3.js';
const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10);
const MIME_EXTENSION_MAP = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
};
function sanitizeFileName(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}
function guessExtension(mimeType, fallback = 'bin') {
    return MIME_EXTENSION_MAP[mimeType.toLowerCase()] || fallback;
}
async function fetchBufferFromUrl(url) {
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
const assetsRoutes = async (fastify) => {
    // Get presigned URL for upload
    fastify.post('/assets/upload-url', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const body = request.body;
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
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to generate upload URL';
            const isBadRequest = error instanceof Error &&
                (message.toLowerCase().includes('invalid') || message.toLowerCase().includes('exceeds'));
            if (!isBadRequest) {
                fastify.log.error(error);
            }
            else {
                fastify.log.warn(error);
            }
            return reply.code(isBadRequest ? 400 : 500).send({
                error: message,
            });
        }
    });
    // Create asset metadata after upload
    fastify.post('/assets', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const authUser = request.user;
        const userId = authUser?.userId || authUser?.id;
        if (!userId) {
            return reply.code(401).send({ error: 'Unauthorized' });
        }
        const body = request.body;
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
        }
        catch (error) {
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
            const includesHidden = query.includeHidden === 'true' || query.includeHidden === '1';
            const excludeTags = new Set();
            if (!includesHidden) {
                excludeTags.add('__hidden');
            }
            if (query.excludeTags) {
                const userExclude = Array.isArray(query.excludeTags)
                    ? query.excludeTags
                    : [query.excludeTags];
                userExclude.forEach((tag) => excludeTags.add(tag));
            }
            if (excludeTags.size > 0) {
                const andConditions = [];
                if (where.AND) {
                    if (Array.isArray(where.AND)) {
                        andConditions.push(...where.AND);
                    }
                    else {
                        andConditions.push(where.AND);
                    }
                }
                andConditions.push({
                    NOT: {
                        tags: {
                            hasSome: Array.from(excludeTags),
                        },
                    },
                });
                where.AND = andConditions;
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
                    orderBy: { updatedAt: 'desc' },
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
        }
        catch (error) {
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
        }
        catch (error) {
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
        }
        catch (error) {
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
        }
        catch (error) {
            fastify.log.error(error);
            return reply.code(500).send({
                error: error instanceof Error ? error.message : 'Failed to delete asset',
            });
        }
    });
    fastify.post('/assets/import', { preHandler: [fastify.authenticateService] }, async (request, reply) => {
        const body = request.body;
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
            let buffer;
            let derivedFileName = body.fileName;
            let derivedMimeType = body.mimeType;
            if (body.sourceUrl) {
                const result = await fetchBufferFromUrl(body.sourceUrl);
                buffer = result.buffer;
                derivedFileName = derivedFileName || result.fileName;
                derivedMimeType = derivedMimeType || result.mimeType;
            }
            else {
                const base64Source = body.dataBase64;
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
            const fileType = body.fileType ||
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
            await s3Client.send(new PutObjectCommand({
                Bucket: assetsBucketName,
                Key: s3Key,
                Body: buffer,
                ContentType: derivedMimeType,
            }));
            let width;
            let height;
            if (fileType === 'image') {
                const metadata = await sharp(buffer).metadata();
                width = metadata.width ?? undefined;
                height = metadata.height ?? undefined;
            }
            let resolvedFolderId;
            if (body.folderId) {
                const folder = await prismaAssets.assetFolder.findUnique({
                    where: { id: body.folderId },
                    select: { id: true, brandId: true },
                });
                if (!folder || folder.brandId !== body.brandId) {
                    return reply.code(400).send({ error: 'Invalid folder selection for brand' });
                }
                resolvedFolderId = folder.id;
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
                    title: body.title,
                    altText: body.altText,
                    tags: body.tags || [],
                    processingStatus: 'pending',
                    folderId: resolvedFolderId,
                },
            });
            if (body.publishedAt) {
                const publishedDate = new Date(body.publishedAt);
                if (!Number.isNaN(publishedDate.getTime())) {
                    await prismaAssets.$executeRaw `
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
                    url: getAssetUrl(asset.s3Key),
                },
                message: 'Asset imported successfully',
            };
        }
        catch (error) {
            fastify.log.error(error);
            return reply.code(500).send({
                error: error instanceof Error ? error.message : 'Failed to import asset',
            });
        }
    });
    fastify.get('/assets/:id/ownership', { preHandler: [fastify.authenticateService] }, async (request, reply) => {
        const { id } = request.params;
        const query = request.query;
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
        }
        catch (error) {
            fastify.log.error(error);
            return reply.code(500).send({
                error: error instanceof Error ? error.message : 'Failed to verify asset ownership',
            });
        }
    });
};
export default assetsRoutes;
