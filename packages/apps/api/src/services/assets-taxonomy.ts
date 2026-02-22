import { createAssetsPrismaClient, type AssetsPrismaClient } from '@postolio/database-assets';
import { ANALYSIS_COLLECTION_NAME } from './assets-media.js';

const ANALYSIS_COLLECTION_COLOR = '#0f172a';

let cachedClient: AssetsPrismaClient | null = null;
let cachedPool: { end: () => Promise<void> } | null = null;
const collectionCache = new Map<string, Promise<string | null>>();

function getAssetsPrismaClient(): AssetsPrismaClient {
  if (!cachedClient) {
    const assetsDatabaseUrl = process.env.ASSETS_DATABASE_URL;
    if (!assetsDatabaseUrl) {
      throw new Error('ASSETS_DATABASE_URL must be set to manage analysis collections');
    }
    const { client, pool } = createAssetsPrismaClient({
      connectionString: assetsDatabaseUrl,
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });
    cachedClient = client;
    cachedPool = pool;
  }

  return cachedClient;
}

async function resolveAnalysisCollection(brandId: string): Promise<string | null> {
  if (!process.env.ASSETS_DATABASE_URL) {
    return null;
  }

  try {
    const prisma = getAssetsPrismaClient();
    const existing = await prisma.assetTaxonomyItem.findFirst({
      where: { brandId, type: 'COLLECTION', name: ANALYSIS_COLLECTION_NAME, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      return existing.id;
    }

    const created = await prisma.assetTaxonomyItem.create({
      data: {
        brandId,
        type: 'COLLECTION',
        name: ANALYSIS_COLLECTION_NAME,
        color: ANALYSIS_COLLECTION_COLOR,
        createdBy: 'system',
      },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    console.warn('Failed to ensure analysis collection', { brandId, error });
    return null;
  }
}

export function ensureAnalysisCollection(brandId: string): Promise<string | null> {
  if (!collectionCache.has(brandId)) {
    collectionCache.set(brandId, resolveAnalysisCollection(brandId));
  }
  return collectionCache.get(brandId)!;
}

export async function disconnectAssetsTaxonomyClient() {
  if (cachedClient) {
    await cachedClient.$disconnect();
    cachedClient = null;
  }
  if (cachedPool) {
    await cachedPool.end();
    cachedPool = null;
  }
  collectionCache.clear();
}
