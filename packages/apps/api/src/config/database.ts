/**
 * Database Configuration
 * Centralized database client management with test support
 */

import { PrismaClient, Prisma } from '@postolio/database';

interface QueryEventLike {
  query: string;
  duration: number;
}

export function getDatabaseUrl(): string {
  // First check if DATABASE_URL is provided
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  // Otherwise, construct from individual variables
  const { DB_USERNAME, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME } = process.env;

  if (!DB_USERNAME || !DB_PASSWORD || !DB_HOST || !DB_PORT || !DB_NAME) {
    throw new Error(
      'Missing required database environment variables: DATABASE_URL or DB_USERNAME, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME'
    );
  }

  // URL encode the username and password to handle special characters
  const encodedUsername = encodeURIComponent(DB_USERNAME);
  const encodedPassword = encodeURIComponent(DB_PASSWORD);

  return `postgresql://${encodedUsername}:${encodedPassword}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public`;
}

// Global database client instance
let prismaInstance: PrismaClient | null = null;

/**
 * Get or create the database client instance with connection pooling
 */
export function getDatabaseClient(): PrismaClient {
  if (!prismaInstance) {
    // Enhanced Prisma configuration with connection pooling
    // Reduce noisy query logs in all environments unless explicitly enabled.
    const enableQueryLogging = (process.env.LOG_QUERIES || '').toLowerCase() === 'true';

    const logLevels: (Prisma.LogLevel | Prisma.LogDefinition)[] = [
      'warn',
      'error',
      // Keep 'info' only for local dev
      ...(process.env.NODE_ENV === 'dev' ? (['info'] as Prisma.LogLevel[]) : []),
      // Emit query events only when explicitly enabled (no stdout spam)
      ...(enableQueryLogging
        ? ([{ level: 'query', emit: 'event' }] as Prisma.LogDefinition[])
        : ([] as Prisma.LogDefinition[])),
    ];

    prismaInstance = new PrismaClient({
      log: logLevels,
      datasources: {
        db: {
          url: process.env.DATABASE_URL || getDatabaseUrl(),
        },
      },
      // Note: Connection pool configuration moved to environment variables
      // DATABASE_URL should include connection pool parameters
    });

    // Connection event handlers
    if (enableQueryLogging) {
      prismaInstance.$on('query' as never, (e: QueryEventLike) => {
        console.log('Query: ' + e.query);
        console.log('Duration: ' + e.duration + 'ms');
      });
    }

    // Graceful shutdown handlers
    const gracefulShutdown = async () => {
      console.log('🔌 Disconnecting from database...');
      try {
        await prismaInstance?.$disconnect();
        console.log('✅ Database disconnected successfully');
      } catch (error) {
        console.error('❌ Error disconnecting from database:', error);
      }
    };

    // Handle process termination
    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);
    process.on('beforeExit', gracefulShutdown);
  }

  return prismaInstance;
}

/**
 * Explicit database disconnect for testing
 */
export async function disconnectDatabase(): Promise<void> {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = null;
  }
}

/**
 * Health check for database connection
 */
export async function checkDatabaseHealth(): Promise<{
  status: 'healthy' | 'unhealthy';
  latency?: number;
  error?: string;
}> {
  try {
    const start = Date.now();
    const client = getDatabaseClient();
    await client.$queryRaw`SELECT 1`;
    const latency = Date.now() - start;

    return {
      status: 'healthy',
      latency,
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown database error',
    };
  }
}

/**
 * Get database connection metrics
 */
export async function getDatabaseMetrics(): Promise<{
  connectionCount?: number;
  queriesExecuted?: number;
  averageQueryTime?: number;
}> {
  try {
    // Get current connection count from PostgreSQL
    const client = getDatabaseClient();
    type ConnectionRow = { connections: number };
    const result = await client.$queryRaw<ConnectionRow[]>`
      SELECT count(*) as connections 
      FROM pg_stat_activity 
      WHERE state = 'active'
    `;

    const connectionCount =
      Array.isArray(result) &&
      result[0] &&
      typeof (result[0] as ConnectionRow).connections !== 'undefined'
        ? Number((result[0] as ConnectionRow).connections)
        : 0;
    return {
      connectionCount,
      // Additional metrics can be added here
    };
  } catch (error) {
    console.error('Failed to get database metrics:', error);
    return {};
  }
}

// Export the client instance for backward compatibility
export const prisma: PrismaClient = getDatabaseClient();
