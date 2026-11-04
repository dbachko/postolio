import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import {
  connectLambdaDatabase,
  type PrismaClient as LambdaPrismaClient,
} from '@postolio/database/lambda';
import { addDays } from 'date-fns';
import { initSentry, captureException } from '@postolio/observability';

let prisma: LambdaPrismaClient;

const logger = new Logger({ serviceName: 'session-cleanup' });
const metrics = new Metrics({
  namespace: 'SessionManagement',
  serviceName: 'session-cleanup',
});

initSentry({
  serviceName: 'session-cleanup',
});

interface CleanupResult {
  expiredSessionsRevoked: number;
  slidingTimeoutExpired: number;
  absoluteTimeoutExpired: number;
  oldRevokedSessionsDeleted: number;
  errors: string[];
}

export const handler = async (): Promise<CleanupResult> => {
  logger.info('Starting session cleanup job');

  const result: CleanupResult = {
    expiredSessionsRevoked: 0,
    slidingTimeoutExpired: 0,
    absoluteTimeoutExpired: 0,
    oldRevokedSessionsDeleted: 0,
    errors: [],
  };

  try {
    prisma ??= await connectLambdaDatabase();

    // 1. Revoke expired sessions (expiresAt < now)
    const expiredCount = await revokeExpiredSessions(result);
    logger.info(`Revoked ${expiredCount} expired sessions`);

    // 2. Check and revoke sessions exceeding sliding timeout (30 days inactivity)
    const slidingCount = await revokeSlidingTimeoutSessions(result);
    logger.info(`Revoked ${slidingCount} sessions due to sliding timeout`);

    // 3. Check and revoke sessions exceeding absolute timeout (90 days)
    const absoluteCount = await revokeAbsoluteTimeoutSessions(result);
    logger.info(`Revoked ${absoluteCount} sessions due to absolute timeout`);

    // 4. Delete old revoked sessions (older than 180 days)
    const deletedCount = await deleteOldRevokedSessions(result);
    logger.info(`Deleted ${deletedCount} old revoked sessions`);

    logger.info('Session cleanup completed', { result });

    // Publish metrics
    metrics.addMetric('ExpiredSessionsRevoked', MetricUnit.Count, result.expiredSessionsRevoked);
    metrics.addMetric('SlidingTimeoutExpired', MetricUnit.Count, result.slidingTimeoutExpired);
    metrics.addMetric('AbsoluteTimeoutExpired', MetricUnit.Count, result.absoluteTimeoutExpired);
    metrics.addMetric(
      'OldRevokedSessionsDeleted',
      MetricUnit.Count,
      result.oldRevokedSessionsDeleted
    );
  } catch (error) {
    logger.error('Session cleanup job failed', error as Error);
    result.errors.push((error as Error).message);
    metrics.addMetric('CleanupJobFailed', MetricUnit.Count, 1);
    captureException(error, {
      function: 'session-cleanup',
    });
  } finally {
    metrics.publishStoredMetrics();
  }

  return result;
};

async function revokeExpiredSessions(result: CleanupResult): Promise<number> {
  logger.info('Revoking expired sessions');

  try {
    const updateResult = await prisma.session.updateMany({
      where: {
        expiresAt: { lt: new Date() },
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
        revokedReason: 'expired',
      },
    });

    result.expiredSessionsRevoked = updateResult.count;
    return updateResult.count;
  } catch (error) {
    logger.error('Failed to revoke expired sessions', error as Error);
    result.errors.push(`Expired sessions: ${(error as Error).message}`);
    return 0;
  }
}

async function revokeSlidingTimeoutSessions(result: CleanupResult): Promise<number> {
  logger.info('Revoking sessions exceeding sliding timeout');

  try {
    const slidingTimeoutDate = addDays(new Date(), -30);

    const updateResult = await prisma.session.updateMany({
      where: {
        lastActivityAt: { lt: slidingTimeoutDate },
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
        revokedReason: 'sliding_timeout',
      },
    });

    result.slidingTimeoutExpired = updateResult.count;
    return updateResult.count;
  } catch (error) {
    logger.error('Failed to revoke sliding timeout sessions', error as Error);
    result.errors.push(`Sliding timeout: ${(error as Error).message}`);
    return 0;
  }
}

async function revokeAbsoluteTimeoutSessions(result: CleanupResult): Promise<number> {
  logger.info('Revoking sessions exceeding absolute timeout');

  try {
    const absoluteTimeoutDate = addDays(new Date(), -90);

    const updateResult = await prisma.session.updateMany({
      where: {
        createdAt: { lt: absoluteTimeoutDate },
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
        revokedReason: 'absolute_timeout',
      },
    });

    result.absoluteTimeoutExpired = updateResult.count;
    return updateResult.count;
  } catch (error) {
    logger.error('Failed to revoke absolute timeout sessions', error as Error);
    result.errors.push(`Absolute timeout: ${(error as Error).message}`);
    return 0;
  }
}

async function deleteOldRevokedSessions(result: CleanupResult): Promise<number> {
  logger.info('Deleting old revoked sessions');

  try {
    const cutoffDate = addDays(new Date(), -180);

    const deleteResult = await prisma.session.deleteMany({
      where: {
        revokedAt: { lt: cutoffDate },
      },
    });

    result.oldRevokedSessionsDeleted = deleteResult.count;
    return deleteResult.count;
  } catch (error) {
    logger.error('Failed to delete old revoked sessions', error as Error);
    result.errors.push(`Delete old sessions: ${(error as Error).message}`);
    return 0;
  }
}
