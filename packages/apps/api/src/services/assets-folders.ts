import { createAssetsPrismaClient, type AssetsPrismaClient } from '@postolio/database-assets';
import { ANALYSIS_FOLDER_NAME } from './assets-media.js';

const ANALYSIS_FOLDER_COLOR = '#0f172a';

let cachedClient: AssetsPrismaClient | null = null;
let cachedPool: { end: () => Promise<void> } | null = null;
const folderCache = new Map<string, Promise<string | null>>();

function getAssetsPrismaClient(): AssetsPrismaClient {
  if (!cachedClient) {
    const assetsDatabaseUrl = process.env.ASSETS_DATABASE_URL;
    if (!assetsDatabaseUrl) {
      throw new Error('ASSETS_DATABASE_URL must be set to manage analysis folders');
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

async function resolveAnalysisFolder(brandId: string): Promise<string | null> {
  if (!process.env.ASSETS_DATABASE_URL) {
    return null;
  }

  try {
    const prisma = getAssetsPrismaClient();
    const existing = await prisma.assetFolder.findFirst({
      where: { brandId, name: ANALYSIS_FOLDER_NAME },
      select: { id: true },
    });
    if (existing) return existing.id;

    const created = await prisma.assetFolder.create({
      data: {
        brandId,
        name: ANALYSIS_FOLDER_NAME,
        folderType: 'brand_assets',
        color: ANALYSIS_FOLDER_COLOR,
      },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    console.warn('Failed to ensure analysis folder', { brandId, error });
    return null;
  }
}

export function ensureAnalysisFolder(brandId: string): Promise<string | null> {
  if (!folderCache.has(brandId)) {
    folderCache.set(brandId, resolveAnalysisFolder(brandId));
  }
  return folderCache.get(brandId)!;
}

export async function disconnectAssetsFolderClient() {
  if (cachedClient) {
    await cachedClient.$disconnect();
    cachedClient = null;
  }
  if (cachedPool) {
    await cachedPool.end();
    cachedPool = null;
  }
  folderCache.clear();
}
