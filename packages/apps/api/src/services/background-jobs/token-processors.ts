import type { Job } from 'bullmq';
import { RefreshTokenService } from '../refresh-token.js';
import type { RedisTokenStore } from '../redis-token-store.js';
import { AuditLogger, AuditEventType } from '../audit-logger.js';
import type { CleanupResult, JobData } from './types.js';

export async function processTokenCleanupJob(job: Job<JobData>): Promise<CleanupResult> {
  const startTime = Date.now();

  try {
    await job.updateProgress(10);
    const deletedCount = await RefreshTokenService.cleanupExpiredTokens();
    await job.updateProgress(90);

    await AuditLogger.log({
      userId: 'system',
      eventType: AuditEventType.SYSTEM_CLEANUP,
      metadata: {
        type: 'token-cleanup',
        deletedCount,
        duration: Date.now() - startTime,
      },
      success: true,
    });

    await job.updateProgress(100);
    return {
      deletedCount,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await AuditLogger.log({
      userId: 'system',
      eventType: AuditEventType.SYSTEM_ERROR,
      metadata: {
        type: 'token-cleanup',
        error: errorMessage,
        duration: Date.now() - startTime,
      },
      success: false,
    });

    throw error;
  }
}

export async function processTokenMigrationJob(
  job: Job<JobData>,
  tokenStore: RedisTokenStore
): Promise<{ migrated: number; errors: string[]; duration: number }> {
  const startTime = Date.now();

  try {
    await job.updateProgress(10);
    const result = await tokenStore.migrateFromKeysToSets();
    await job.updateProgress(90);

    await AuditLogger.log({
      userId: 'system',
      eventType: AuditEventType.SYSTEM_MIGRATION,
      metadata: {
        type: 'token-migration',
        migrated: result.migrated,
        errors: result.errors.length,
        duration: Date.now() - startTime,
      },
      success: result.errors.length === 0,
    });

    await job.updateProgress(100);
    return {
      ...result,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await AuditLogger.log({
      userId: 'system',
      eventType: AuditEventType.SYSTEM_ERROR,
      metadata: {
        type: 'token-migration',
        error: errorMessage,
        duration: Date.now() - startTime,
      },
      success: false,
    });

    throw error;
  }
}

export async function processTokenIntegrityCheckJob(
  job: Job<JobData>,
  tokenStore: RedisTokenStore
): Promise<{
  valid: boolean;
  orphanedTokens: string[];
  missingFromSets: string[];
  duration: number;
}> {
  const startTime = Date.now();

  try {
    await job.updateProgress(10);
    const result = await tokenStore.verifyIntegrity();
    await job.updateProgress(70);

    if (result.orphanedTokens.length > 0) {
      for (const tokenId of result.orphanedTokens) {
        await tokenStore.deleteToken(tokenId);
      }
    }

    await job.updateProgress(90);

    await AuditLogger.log({
      userId: 'system',
      eventType: AuditEventType.SYSTEM_INTEGRITY_CHECK,
      metadata: {
        type: 'token-integrity',
        valid: result.valid,
        orphaned: result.orphanedTokens.length,
        missingFromSets: result.missingFromSets.length,
        duration: Date.now() - startTime,
      },
      success: true,
    });

    await job.updateProgress(100);
    return {
      ...result,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await AuditLogger.log({
      userId: 'system',
      eventType: AuditEventType.SYSTEM_ERROR,
      metadata: {
        type: 'token-integrity-check',
        error: errorMessage,
        duration: Date.now() - startTime,
      },
      success: false,
    });

    throw error;
  }
}

export async function processAuditLogCleanupJob(
  job: Job<JobData>
): Promise<{ cutoffDate: string; duration: number }> {
  const startTime = Date.now();

  try {
    await job.updateProgress(10);

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);

    await job.updateProgress(90);

    await AuditLogger.log({
      userId: 'system',
      eventType: AuditEventType.SYSTEM_CLEANUP,
      metadata: {
        type: 'audit-log-cleanup',
        cutoffDate: cutoffDate.toISOString(),
        duration: Date.now() - startTime,
      },
      success: true,
    });

    await job.updateProgress(100);
    return {
      cutoffDate: cutoffDate.toISOString(),
      duration: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await AuditLogger.log({
      userId: 'system',
      eventType: AuditEventType.SYSTEM_ERROR,
      metadata: {
        type: 'audit-log-cleanup',
        error: errorMessage,
        duration: Date.now() - startTime,
      },
      success: false,
    });

    throw error;
  }
}
