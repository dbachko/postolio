import type { FastifyInstance } from 'fastify';

import { getRedisClient } from '../../services/redis.js';
import { backgroundJobs, JobType } from '../../services/background-jobs.js';
import { parseBoundedInt, parseQueryList, prisma, requireInboxFeature } from './shared.js';

async function getOwnedBrand(brandId: string, userId: string) {
  return prisma.brand.findFirst({ where: { id: brandId, userId } });
}

async function checkThrottle(throttleKey: string) {
  const redis = getRedisClient();
  if (!redis) {
    return { redis: null, limited: false, nextAllowed: null as string | null };
  }

  const ttl = await redis.ttl(throttleKey);
  if (ttl > 0) {
    return {
      redis,
      limited: true,
      nextAllowed: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  await redis.setex(throttleKey, 5 * 60, '1');
  return { redis, limited: false, nextAllowed: null as string | null };
}

async function enqueueJobWithRollback(params: {
  redis: ReturnType<typeof getRedisClient>;
  throttleKey: string;
  jobType: JobType;
  payload: Record<string, unknown>;
}) {
  try {
    const job = await backgroundJobs.scheduleJob(params.jobType, params.payload);
    return job.id;
  } catch (error) {
    if (params.redis) {
      try {
        await params.redis.del(params.throttleKey);
      } catch {
        // Ignore throttle rollback failures
      }
    }
    throw error;
  }
}

function parseSyncFlag(value: unknown): boolean {
  return String(value || '').toLowerCase() === 'true';
}

function registerCommentIngestRoute(fastify: FastifyInstance): void {
  fastify.post<{
    Params: { id: string };
    Querystring: {
      sync?: string;
      socialAccountId?: string | string[];
      maxPosts?: string;
      perPostLimit?: string;
    };
  }>(
    '/:id/inbox/comments/ingest',
    { preHandler: [fastify.authenticate, requireInboxFeature] },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id: brandId } = request.params;
        const brand = await getOwnedBrand(brandId, userId);
        if (!brand) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        const socialAccountIds = parseQueryList(request.query.socialAccountId);
        const sync = parseSyncFlag(request.query.sync);
        const maxPosts = parseBoundedInt(request.query.maxPosts, 50, 1, 200);
        const perPostLimit = parseBoundedInt(request.query.perPostLimit, 100, 1, 200);

        if (sync) {
          const { ingestBrandComments } = await import('../../services/inbox-comments-ingestor.js');
          const result = await ingestBrandComments(brandId, maxPosts, perPostLimit, {
            socialAccountIds,
          });
          return reply.send({ success: true, enqueued: false, result });
        }

        const throttleKey = `ingest:brand:comments:${brandId}`;
        const throttle = await checkThrottle(throttleKey);
        if (throttle.limited) {
          return reply.code(429).send({
            success: false,
            error: 'Ingestion recently requested',
            nextAllowed: throttle.nextAllowed,
          });
        }

        const jobId = await enqueueJobWithRollback({
          redis: throttle.redis,
          throttleKey,
          jobType: JobType.INBOX_COMMENTS_INGEST,
          payload: {
            brandId,
            socialAccountIds,
            maxPosts,
            perPostLimit,
            triggeredBy: userId,
          },
        });

        const nextAllowed = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        return reply.send({ success: true, enqueued: true, jobId, nextAllowed });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to enqueue comments ingestion');
        return reply.code(500).send({ error: 'Failed to enqueue comments ingestion' });
      }
    }
  );
}

function registerDMIngestRoute(fastify: FastifyInstance): void {
  fastify.post<{
    Params: { id: string };
    Querystring: {
      sync?: string;
      socialAccountId?: string | string[];
      maxThreads?: string;
      perThreadLimit?: string;
    };
  }>(
    '/:id/inbox/dms/ingest',
    { preHandler: [fastify.authenticate, requireInboxFeature] },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id: brandId } = request.params;
        const brand = await getOwnedBrand(brandId, userId);
        if (!brand) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        const socialAccountIds = parseQueryList(request.query.socialAccountId);
        const sync = parseSyncFlag(request.query.sync);
        const maxThreads = parseBoundedInt(request.query.maxThreads, 25, 1, 50);
        const perThreadLimit = parseBoundedInt(request.query.perThreadLimit, 30, 1, 50);

        if (sync) {
          const { ingestBrandDMs } = await import('../../services/inbox-dm-ingestor.js');
          const result = await ingestBrandDMs(brandId, maxThreads, perThreadLimit, {
            socialAccountIds,
          });
          return reply.send({ success: true, enqueued: false, result });
        }

        const throttleKey = `ingest:brand:dms:${brandId}`;
        const throttle = await checkThrottle(throttleKey);
        if (throttle.limited) {
          return reply.code(429).send({
            success: false,
            error: 'Ingestion recently requested',
            nextAllowed: throttle.nextAllowed,
          });
        }

        const jobId = await enqueueJobWithRollback({
          redis: throttle.redis,
          throttleKey,
          jobType: JobType.INBOX_DMS_INGEST,
          payload: {
            brandId,
            socialAccountIds,
            maxThreads,
            perThreadLimit,
            triggeredBy: userId,
          },
        });

        const nextAllowed = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        return reply.send({ success: true, enqueued: true, jobId, nextAllowed });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to enqueue DMs ingestion');
        return reply.code(500).send({ error: 'Failed to enqueue DMs ingestion' });
      }
    }
  );
}

export function registerBrandInboxIngestRoutes(fastify: FastifyInstance): void {
  registerCommentIngestRoute(fastify);
  registerDMIngestRoute(fastify);
}
