import { PrismaClient } from './assets-client/index.js';

// Prevent multiple instances in development
const globalForPrisma = globalThis as unknown as {
  prismaAssets: PrismaClient | undefined;
};

export const prismaAssets =
  globalForPrisma.prismaAssets ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prismaAssets = prismaAssets;
}

// Re-export Prisma types for convenience
export * from './assets-client/index.js';
export { PrismaClient as AssetsPrismaClient, Prisma } from './assets-client/index.js';

// Export types
export type {
  Asset,
  AssetFolder,
  CampaignAsset,
  AssetType,
  ProcessingStatus,
  FolderType,
} from './assets-client/index.js';
