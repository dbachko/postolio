import { Pool, PoolConfig } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Prisma } from './lambda-client';
import { PrismaClient as LambdaPrismaClient } from './lambda-client';

export type { Prisma } from './lambda-client';
export * from './lambda-client';

export interface LambdaPrismaClientOptions extends Prisma.PrismaClientOptions {
  connectionString?: string;
  pool?: Pool;
  poolConfig?: PoolConfig;
}

export interface LambdaPrismaInstance {
  client: LambdaPrismaClient;
  pool: Pool;
}

export function createLambdaPrismaClient(
  options: LambdaPrismaClientOptions = {}
): LambdaPrismaInstance {
  const { connectionString, pool, poolConfig, ...prismaOptions } = options;
  const resolvedPool =
    pool ?? new Pool(poolConfig ?? (connectionString ? { connectionString } : undefined));
  const adapter = new PrismaPg(resolvedPool);
  const client = new LambdaPrismaClient({
    ...prismaOptions,
    adapter,
  });

  return { client, pool: resolvedPool };
}
