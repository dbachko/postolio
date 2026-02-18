import { Pool, type PoolConfig } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '@prisma/client';

// Re-export everything from Prisma client.
// Keep this as a star export to preserve the Prisma namespace types (e.g. Prisma.InputJsonValue).
export * from '@prisma/client';
export { PrismaClient, Prisma } from '@prisma/client';

export type { User, Brand, Content, AuditLog, ContentStatus } from '@prisma/client';

export interface PgPrismaClientOptions extends Prisma.PrismaClientOptions {
  connectionString?: string;
  pool?: Pool;
  poolConfig?: PoolConfig;
}

export interface PrismaClientWithPool {
  client: PrismaClient;
  pool: Pool;
}

export function createPrismaClient(options: PgPrismaClientOptions = {}): PrismaClientWithPool {
  const { connectionString, pool, poolConfig, ...prismaOptions } = options;
  const resolvedPool =
    pool ?? new Pool(poolConfig ?? (connectionString ? { connectionString } : undefined));
  const adapter = new PrismaPg(resolvedPool);
  const client = new PrismaClient({
    ...prismaOptions,
    adapter,
  });

  return { client, pool: resolvedPool };
}
