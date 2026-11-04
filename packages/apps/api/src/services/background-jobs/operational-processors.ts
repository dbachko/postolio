import type { Job } from 'bullmq';
import type { JobData, CleanupResult } from './types.js';

type LoggerLike = {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
};

export async function processNotificationRetentionJob(): Promise<CleanupResult> {
  const start = Date.now();
  const maxAgeDays = Number(process.env.NOTIFICATION_RETENTION_DAYS || 90);
  const { notificationsService } = await import('../notifications.js');
  const res = await notificationsService.purgeOld(maxAgeDays);
  return { deletedCount: res.deleted, duration: Date.now() - start };
}

export async function processInboxCommentsIngestJob(job: Job<JobData>): Promise<{
  brandId: string;
  postsProcessed: number;
  commentsUpserted: number;
  duration: number;
}> {
  const start = Date.now();
  const brandId = String(job.data.metadata?.brandId ?? '').trim();
  const maxPosts = Number(job.data.metadata?.maxPosts ?? 50);
  const perPostLimit = Number(job.data.metadata?.perPostLimit ?? 100);
  const minStaleMs = Number(job.data.metadata?.minStaleMs ?? 0);
  const socialAccountIdsRaw = job.data.metadata?.socialAccountIds;
  const socialAccountIds = Array.isArray(socialAccountIdsRaw)
    ? (socialAccountIdsRaw as unknown[]).map(String).filter(Boolean)
    : [];

  if (!brandId) {
    throw new Error('Missing brandId for inbox comments ingest job');
  }

  await job.updateProgress(5);
  const { ingestBrandComments } = await import('../inbox-comments-ingestor.js');
  await job.updateProgress(15);

  const result = await ingestBrandComments(
    brandId,
    Number.isFinite(maxPosts) ? maxPosts : 50,
    Number.isFinite(perPostLimit) ? perPostLimit : 100,
    {
      minStaleMs: Number.isFinite(minStaleMs) ? minStaleMs : 0,
      socialAccountIds,
    }
  );
  await job.updateProgress(100);

  return {
    brandId,
    ...result,
    duration: Date.now() - start,
  };
}

export async function processInboxCommentsBackfillJob(
  job: Job<JobData>,
  logger: LoggerLike
): Promise<{
  brandsTotal: number;
  brandsProcessed: number;
  brandsFailed: number;
  postsProcessed: number;
  commentsUpserted: number;
  duration: number;
}> {
  const start = Date.now();
  const prisma = (await import('../../config/database.js')).getDatabaseClient();
  const { ingestBrandComments } = await import('../inbox-comments-ingestor.js');

  const maxPosts = Number(
    job.data.metadata?.maxPosts ?? process.env.INBOX_COMMENTS_BACKFILL_MAX_POSTS ?? 20
  );
  const perPostLimit = Number(
    job.data.metadata?.perPostLimit ?? process.env.INBOX_COMMENTS_BACKFILL_PER_POST_LIMIT ?? 50
  );
  const minStaleMs = Number(
    job.data.metadata?.minStaleMs ??
      process.env.INBOX_COMMENTS_BACKFILL_MIN_STALE_MS ??
      15 * 60 * 1000
  );

  const brands = await prisma.brand.findMany({
    where: { socialAccounts: { some: { platform: { in: ['instagram', 'facebook'] } } } },
    select: { id: true },
  });

  const safeMaxPosts = Number.isFinite(maxPosts) ? maxPosts : 20;
  const safePerPostLimit = Number.isFinite(perPostLimit) ? perPostLimit : 50;
  const safeMinStaleMs = Number.isFinite(minStaleMs) ? minStaleMs : 15 * 60 * 1000;

  let brandsProcessed = 0;
  let brandsFailed = 0;
  let postsProcessed = 0;
  let commentsUpserted = 0;

  for (let i = 0; i < brands.length; i++) {
    const brand = brands[i];
    try {
      const res = await ingestBrandComments(brand.id, safeMaxPosts, safePerPostLimit, {
        minStaleMs: safeMinStaleMs,
      });
      brandsProcessed++;
      postsProcessed += res.postsProcessed;
      commentsUpserted += res.commentsUpserted;
    } catch (error) {
      brandsFailed++;
      logger.warn('Inbox comments backfill failed for brand', {
        brandId: brand.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await job.updateProgress(Math.min(99, Math.round(((i + 1) / brands.length) * 100)));
  }

  await job.updateProgress(100);
  return {
    brandsTotal: brands.length,
    brandsProcessed,
    brandsFailed,
    postsProcessed,
    commentsUpserted,
    duration: Date.now() - start,
  };
}

export async function processInboxDMsIngestJob(job: Job<JobData>): Promise<{
  brandId: string;
  accountsProcessed: number;
  threadsProcessed: number;
  conversationsUpserted: number;
  messagesInserted: number;
  duration: number;
}> {
  const start = Date.now();
  const brandId = String(job.data.metadata?.brandId ?? '').trim();
  const maxThreads = Number(job.data.metadata?.maxThreads ?? 25);
  const perThreadLimit = Number(job.data.metadata?.perThreadLimit ?? 30);
  const minStaleMs = Number(job.data.metadata?.minStaleMs ?? 0);
  const socialAccountIdsRaw = job.data.metadata?.socialAccountIds;
  const socialAccountIds = Array.isArray(socialAccountIdsRaw)
    ? (socialAccountIdsRaw as unknown[]).map(String).filter(Boolean)
    : [];

  if (!brandId) {
    throw new Error('Missing brandId for inbox DMs ingest job');
  }

  await job.updateProgress(5);
  const { ingestBrandDMs } = await import('../inbox-dm-ingestor.js');
  await job.updateProgress(15);

  const result = await ingestBrandDMs(
    brandId,
    Number.isFinite(maxThreads) ? maxThreads : 25,
    Number.isFinite(perThreadLimit) ? perThreadLimit : 30,
    {
      socialAccountIds,
      minStaleMs: Number.isFinite(minStaleMs) ? minStaleMs : 0,
    }
  );

  await job.updateProgress(100);
  return { brandId, ...result, duration: Date.now() - start };
}

export async function processPublishingQueueWindowMaintenanceJob(logger: LoggerLike): Promise<{
  processed: number;
  assigned: number;
  scheduled: number;
  rescheduled: number;
  cancelled: number;
  errors: number;
}> {
  const start = Date.now();
  let processed = 0;
  let assigned = 0;
  let scheduled = 0;
  let rescheduled = 0;
  let cancelled = 0;
  let errors = 0;

  try {
    const prisma = (await import('../../config/database.js')).getDatabaseClient();
    const { publishingQueueScheduler } = await import('../publishing-queue/queue-scheduler.js');

    const batchSize = (() => {
      const raw = process.env.PUBLISHING_QUEUE_WINDOW_MAINTENANCE_BATCH_SIZE;
      const n = raw ? parseInt(raw, 10) : 50;
      return Number.isFinite(n) ? Math.max(1, Math.min(500, n)) : 50;
    })();
    const lookbackMinutes = (() => {
      const raw = process.env.PUBLISHING_QUEUE_WINDOW_MAINTENANCE_LOOKBACK_MINUTES;
      const n = raw ? parseInt(raw, 10) : 15;
      return Number.isFinite(n) ? Math.max(1, Math.min(180, n)) : 15;
    })();
    const since = new Date(Date.now() - lookbackMinutes * 60 * 1000);

    const brands = await prisma.content.findMany({
      where: {
        updatedAt: { gte: since },
        publishingQueueItem: { isNot: null },
      },
      select: { brandId: true },
      distinct: ['brandId'],
      take: batchSize,
      orderBy: { updatedAt: 'desc' },
    });

    for (const brand of brands) {
      processed += 1;
      try {
        const res = await publishingQueueScheduler.recomputeBrandWindow(brand.brandId);
        assigned += res.assigned;
        scheduled += res.scheduled;
        rescheduled += res.rescheduled;
        cancelled += res.cancelled;
        errors += res.errors.length;
      } catch {
        errors += 1;
      }
    }

    logger.info('Publishing queue window maintenance completed', {
      processed,
      assigned,
      scheduled,
      rescheduled,
      cancelled,
      errors,
      durationMs: Date.now() - start,
    });

    return { processed, assigned, scheduled, rescheduled, cancelled, errors };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Publishing queue window maintenance error', {
      error: {
        name: err.name,
        message: err.message,
        stack: err.stack,
      },
    });
    return { processed, assigned, scheduled, rescheduled, cancelled, errors };
  }
}
