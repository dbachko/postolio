import {
  connectLambdaDatabase,
  type Platform,
  type PrismaClient as LambdaPrismaClient,
} from '@postolio/database/lambda';
import { SESClient } from '@aws-sdk/client-ses';
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics } from '@aws-lambda-powertools/metrics';
import { initSentry } from '@postolio/observability';

export const logger = new Logger({ serviceName: 'status-sync' });

export const metrics = new Metrics({
  namespace: 'Postolio/StatusSync',
  serviceName: 'status-sync',
});

initSentry({ serviceName: 'status-sync' });

export const sesClient = new SESClient({});

let prisma: LambdaPrismaClient | null = null;

export function toDatabasePlatform(platform: string | undefined): Platform | null {
  const normalized = (platform || '').toLowerCase().trim();
  if (!normalized) {
    return null;
  }

  if (normalized === 'twitter') {
    return 'x';
  }

  const validPlatforms = ['instagram', 'facebook', 'linkedin', 'x', 'youtube', 'tiktok'];
  return validPlatforms.includes(normalized) ? (normalized as Platform) : null;
}

export async function getClient(): Promise<LambdaPrismaClient> {
  prisma ??= await connectLambdaDatabase();
  return prisma;
}
