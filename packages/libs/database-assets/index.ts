import { PrismaClient } from '@prisma/client';

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
export * from '@prisma/client';
export { PrismaClient, Prisma } from '@prisma/client';

// Export types
export type {
  Asset,
  AssetFolder,
  CampaignAsset,
  AssetType,
  ProcessingStatus,
  FolderType,
} from '@prisma/client';
