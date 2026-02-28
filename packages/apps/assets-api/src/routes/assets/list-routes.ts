import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prismaAssets, type Prisma as AssetsPrisma } from '@postolio/database-assets';
import { mapAssetWithLabelsAndUrls, UNSORTED_COLLECTION_FILTER } from './shared.js';

interface AssetListQuery {
  brandId?: string;
  type?: 'image' | 'video';
  search?: string;
  page?: string;
  limit?: string;
  collectionId?: string;
  includeSubcollections?: string;
  labelIds?: string | string[];
  labelMode?: 'any' | 'all';
  aspectRatio?: string;
  aspectRatios?: string | string[];
  orientationType?: 'portrait' | 'landscape' | 'square';
  orientationTypes?: string | string[];
  minWidth?: string;
  maxWidth?: string;
  minHeight?: string;
  maxHeight?: string;
  uploadedAfter?: string;
  uploadedBefore?: string;
  usage?: 'used' | 'unused' | 'any';
}

interface AspectRatioQuery {
  brandId?: string;
}

export function registerListRoutes(fastify: FastifyInstance): void {
  fastify.get('/assets', { preHandler: [fastify.authenticateService] }, async (request, reply) =>
    handleListAssets(request, reply)
  );

  fastify.get(
    '/assets/aspect-ratios',
    { preHandler: [fastify.authenticateService] },
    async (request, reply) => handleAspectRatios(request, reply)
  );
}

async function handleListAssets(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const query = request.query as AssetListQuery;

  try {
    const brandId = query.brandId;
    if (!brandId) {
      return reply.code(400).send({ error: 'brandId is required' });
    }

    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const where = await buildAssetWhereClause(query, brandId, reply);
    if (!where) {
      return;
    }

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

    return {
      assets: assets.map((asset) => mapAssetWithLabelsAndUrls(asset)),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({
      error: error instanceof Error ? error.message : 'Failed to fetch assets',
    });
  }
}

function parsePagination(
  pageInput?: string,
  limitInput?: string
): {
  page: number;
  limit: number;
  skip: number;
} {
  const page = parseInt(pageInput || '1', 10);
  const limit = Math.min(parseInt(limitInput || '50', 10), 100);
  const skip = (page - 1) * limit;

  return { page, limit, skip };
}

async function buildAssetWhereClause(
  query: AssetListQuery,
  brandId: string,
  reply: FastifyReply
): Promise<AssetsPrisma.AssetWhereInput | null> {
  const where: AssetsPrisma.AssetWhereInput = {
    brandId,
    archivedAt: null,
  };

  if (query.type) {
    where.fileType = query.type;
  }

  const collectionFilterResult = await applyCollectionFilter(where, query, brandId, reply);
  if (!collectionFilterResult) {
    return null;
  }

  applyLabelFilter(where, query);
  applySearchFilter(where, query.search);
  applyAspectRatioFilters(where, query);
  applyDimensionFilters(where, query);

  const dateFilterError = applyDateFilters(where, query, reply);
  if (dateFilterError) {
    return null;
  }

  applyUsageFilter(where, query.usage);
  return where;
}

async function applyCollectionFilter(
  where: AssetsPrisma.AssetWhereInput,
  query: AssetListQuery,
  brandId: string,
  reply: FastifyReply
): Promise<boolean> {
  if (!query.collectionId) {
    return true;
  }

  if (query.collectionId === UNSORTED_COLLECTION_FILTER) {
    where.collectionId = null;
    return true;
  }

  const includeSub = query.includeSubcollections === 'true' || query.includeSubcollections === '1';
  const collectionIds = includeSub
    ? await findCollectionIdsWithSubcollections(query.collectionId, brandId)
    : [query.collectionId];

  if (collectionIds.length === 0) {
    reply.send({
      assets: [],
      pagination: { total: 0, page: 1, limit: 50, totalPages: 0 },
    });
    return false;
  }

  where.collectionId = { in: collectionIds };
  return true;
}

async function findCollectionIdsWithSubcollections(
  collectionId: string,
  brandId: string
): Promise<string[]> {
  const rows = await prismaAssets.$queryRaw<Array<{ id: string }>>`
    WITH RECURSIVE subcollections AS (
      SELECT "id"
      FROM "asset_taxonomy_items"
      WHERE "id" = ${collectionId}
        AND "brandId" = ${brandId}
        AND "type" = 'COLLECTION'
        AND "deletedAt" IS NULL
      UNION ALL
      SELECT c."id"
      FROM "asset_taxonomy_items" c
      JOIN subcollections s ON c."parentId" = s."id"
      WHERE c."brandId" = ${brandId}
        AND c."type" = 'COLLECTION'
        AND c."deletedAt" IS NULL
    )
    SELECT "id" FROM subcollections;
  `;

  return rows.map((row) => row.id);
}

function applyLabelFilter(where: AssetsPrisma.AssetWhereInput, query: AssetListQuery): void {
  const labelIds = normalizeStringArray(query.labelIds);
  if (labelIds.length === 0) {
    return;
  }

  if (query.labelMode !== 'all') {
    where.labelAssignments = { some: { taxonomyItemId: { in: labelIds } } };
    return;
  }

  const andConditions = ensureAndConditions(where);
  labelIds.forEach((id) => {
    andConditions.push({ labelAssignments: { some: { taxonomyItemId: id } } });
  });
}

function applySearchFilter(where: AssetsPrisma.AssetWhereInput, search?: string): void {
  if (!search) {
    return;
  }

  where.OR = [
    { title: { contains: search, mode: 'insensitive' } },
    { description: { contains: search, mode: 'insensitive' } },
    { fileName: { contains: search, mode: 'insensitive' } },
  ];
}

function applyAspectRatioFilters(where: AssetsPrisma.AssetWhereInput, query: AssetListQuery): void {
  if (query.aspectRatio) {
    where.aspectRatio = query.aspectRatio;
  }

  const ratios = normalizeStringArray(query.aspectRatios);
  if (ratios.length > 0) {
    where.aspectRatio = { in: ratios };
  }

  const orientationTypes = normalizeStringArray(query.orientationTypes);
  if (orientationTypes.length > 0) {
    where.orientationType = { in: orientationTypes };
    return;
  }

  if (query.orientationType) {
    where.orientationType = query.orientationType;
  }
}

function applyDimensionFilters(where: AssetsPrisma.AssetWhereInput, query: AssetListQuery): void {
  if (query.minWidth || query.maxWidth) {
    ensureAndConditions(where).push({ width: { not: null } });
    where.width = {
      ...(query.minWidth && { gte: parseInt(query.minWidth, 10) }),
      ...(query.maxWidth && { lte: parseInt(query.maxWidth, 10) }),
    };
  }

  if (query.minHeight || query.maxHeight) {
    ensureAndConditions(where).push({ height: { not: null } });
    where.height = {
      ...(query.minHeight && { gte: parseInt(query.minHeight, 10) }),
      ...(query.maxHeight && { lte: parseInt(query.maxHeight, 10) }),
    };
  }
}

function applyDateFilters(
  where: AssetsPrisma.AssetWhereInput,
  query: AssetListQuery,
  reply: FastifyReply
): boolean {
  if (!query.uploadedAfter && !query.uploadedBefore) {
    return false;
  }

  const after = query.uploadedAfter ? parseDate(query.uploadedAfter) : null;
  const before = query.uploadedBefore ? parseDate(query.uploadedBefore) : null;

  if (query.uploadedAfter && !after) {
    reply.code(400).send({ error: 'Invalid uploadedAfter date format' });
    return true;
  }

  if (query.uploadedBefore && !before) {
    reply.code(400).send({ error: 'Invalid uploadedBefore date format' });
    return true;
  }

  where.createdAt = {
    ...(after && { gte: after }),
    ...(before && { lte: before }),
  };
  return false;
}

function applyUsageFilter(
  where: AssetsPrisma.AssetWhereInput,
  usage?: AssetListQuery['usage']
): void {
  if (usage === 'used') {
    where.usageCount = { gt: 0 };
    return;
  }

  if (usage === 'unused') {
    where.usageCount = 0;
  }
}

function ensureAndConditions(where: AssetsPrisma.AssetWhereInput): AssetsPrisma.AssetWhereInput[] {
  if (!where.AND) {
    where.AND = [];
  }

  if (!Array.isArray(where.AND)) {
    where.AND = [where.AND];
  }

  return where.AND;
}

function parseDate(value: string): Date | null {
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function normalizeStringArray(value: string | string[] | undefined): string[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

async function handleAspectRatios(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const query = request.query as AspectRatioQuery;
  if (!query.brandId) {
    return reply.code(400).send({ error: 'brandId is required' });
  }

  try {
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

    return {
      aspectRatios: results
        .map((result) => ({
          aspectRatio: result.aspectRatio,
          orientationType: result.orientationType,
          count: result._count.id,
        }))
        .sort((a, b) => b.count - a.count),
      common: getCommonAspectRatios(),
    };
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({
      error: error instanceof Error ? error.message : 'Failed to fetch aspect ratios',
    });
  }
}

function getCommonAspectRatios(): Array<{ label: string; value: string; platform: string }> {
  return [
    { label: '1:1 - Square', value: '1:1', platform: 'Instagram Post, Facebook' },
    { label: '4:5 - Portrait', value: '4:5', platform: 'Instagram Feed' },
    { label: '9:16 - Full vertical', value: '9:16', platform: 'Stories, Reels, TikTok' },
    { label: '3:4 - Tall classic', value: '3:4', platform: 'Pinterest, Portrait' },
    { label: '4:3 - Photo classic', value: '4:3', platform: 'Traditional Photo' },
    { label: '16:9 - Standard landscape', value: '16:9', platform: 'YouTube, Twitter/X' },
    { label: '1.91:1 - Social ads landscape', value: '1.91:1', platform: 'Facebook Ads' },
    { label: '2:1 - Ultra-wide', value: '2:1', platform: 'Ultra-wide displays' },
    { label: '2.39:1 - Cinematic wide', value: '2.39:1', platform: 'Cinematic films' },
  ];
}
