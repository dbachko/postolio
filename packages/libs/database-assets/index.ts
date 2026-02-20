import { Pool, type PoolConfig } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from './assets-client/index.js';

export interface PgAssetsPrismaClientOptions extends Prisma.PrismaClientOptions {
  connectionString?: string;
  pool?: Pool;
  poolConfig?: PoolConfig;
}

export interface AssetsPrismaClientWithPool {
  client: PrismaClient;
  pool: Pool;
}

export function normalizeAssetLabelName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

export function createAssetsPrismaClient(
  options: PgAssetsPrismaClientOptions = {}
): AssetsPrismaClientWithPool {
  const { connectionString, pool, poolConfig, ...prismaOptions } = options;
  const resolvedConnectionString = connectionString ?? process.env.ASSETS_DATABASE_URL;
  const resolvedPool =
    pool ??
    new Pool(
      poolConfig ??
        (resolvedConnectionString ? { connectionString: resolvedConnectionString } : undefined)
    );
  const adapter = new PrismaPg(resolvedPool);
  const client = new PrismaClient({
    ...prismaOptions,
    adapter,
  });

  return { client, pool: resolvedPool };
}

// Prevent multiple instances in development
const globalForPrisma = globalThis as unknown as {
  prismaAssets: PrismaClient | undefined;
  prismaAssetsPool: Pool | undefined;
};

const assetsDatabaseUrl = process.env.ASSETS_DATABASE_URL;
export const prismaAssetsPool =
  globalForPrisma.prismaAssetsPool ??
  new Pool(assetsDatabaseUrl ? { connectionString: assetsDatabaseUrl } : undefined);

export const prismaAssets =
  globalForPrisma.prismaAssets ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    adapter: new PrismaPg(prismaAssetsPool),
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prismaAssets = prismaAssets;
  globalForPrisma.prismaAssetsPool = prismaAssetsPool;
}

// Re-export Prisma types for convenience
export * from './assets-client/index.js';
export { PrismaClient as AssetsPrismaClient, Prisma } from './assets-client/index.js';

// Export types
export type {
  Asset,
  AssetType,
  ProcessingStatus,
  AssetTaxonomyItem,
  AssetTaxonomyAssignment,
  TaxonomyType,
} from './assets-client/index.js';
