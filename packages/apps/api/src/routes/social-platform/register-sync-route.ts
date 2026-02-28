import type { FastifyInstance } from 'fastify';
import { APIError } from '@postolio/errors';

import {
  OptionalSocialAccountBodySchema,
  PlatformParamSchema,
  assertBrandOwnershipWithAudit,
  ensurePlatformSupported,
  logger,
  SocialRouteReplyError,
} from './shared.js';
import {
  auditSyncSuccess,
  enforceSyncCooldown,
  listRecentPlatformPosts,
  resolveSyncTarget,
  setSyncCooldown,
  syncFetchedPosts,
} from './sync-helpers.js';

function buildSyncResponse(params: {
  platform: string;
  syncedCount: number;
  skippedCount: number;
  failedCount: number;
  total: number;
  errors: string[];
}) {
  return {
    success: true,
    platform: params.platform,
    synced: params.syncedCount,
    skipped: params.skippedCount,
    failed: params.failedCount,
    total: params.total,
    results: {
      synced: params.syncedCount,
      skipped: params.skippedCount,
      failed: params.failedCount,
      errors: params.errors,
    },
  };
}

async function runSyncFlow(params: {
  req: any;
  platform: string;
  brandId: string;
  userId: string;
  preferredSocialAccountId?: string;
}) {
  await enforceSyncCooldown({
    req: params.req,
    userId: params.userId,
    brandId: params.brandId,
    platform: params.platform,
  });

  const syncTarget = await resolveSyncTarget({
    userId: params.userId,
    brandId: params.brandId,
    platform: params.platform,
    preferredSocialAccountId: params.preferredSocialAccountId,
  });
  const listResult = await listRecentPlatformPosts({
    connector: syncTarget.connector,
    tokens: syncTarget.tokens,
    socialAccount: syncTarget.socialAccount,
    platform: params.platform,
  });
  const stats = await syncFetchedPosts({
    posts: listResult.data,
    brandId: params.brandId,
    userId: params.userId,
    platform: params.platform,
    socialAccountId: syncTarget.socialAccount.id,
  });
  await setSyncCooldown(params.brandId, params.platform);

  await auditSyncSuccess({
    req: params.req,
    userId: params.userId,
    brandId: params.brandId,
    platform: params.platform,
    syncedCount: stats.syncedCount,
    skippedCount: stats.skippedCount,
    totalPosts: listResult.data.length,
  });

  return buildSyncResponse({
    platform: params.platform,
    syncedCount: stats.syncedCount,
    skippedCount: stats.skippedCount,
    failedCount: stats.failedCount,
    total: listResult.data.length,
    errors: stats.errors,
  });
}

export function registerSocialSyncRoute(app: FastifyInstance) {
  app.post(
    '/api/social/:platform/sync/:brandId',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        const { platform, brandId } = PlatformParamSchema.parse(req.params);
        const body = OptionalSocialAccountBodySchema.parse((req.body || {}) as unknown);
        const userId = req.user!.id;

        const platformError = ensurePlatformSupported(platform);
        if (platformError) {
          return reply.code(platformError.statusCode).send(platformError.body);
        }

        await assertBrandOwnershipWithAudit({
          req,
          userId,
          brandId,
          platform,
          operation: 'sync',
        });

        logger.info('Syncing posts from platform', { platform, brandId });
        const response = await runSyncFlow({
          req,
          platform,
          brandId,
          userId,
          preferredSocialAccountId: body.socialAccountId,
        });
        return reply.send(response);
      } catch (error: unknown) {
        if (error instanceof SocialRouteReplyError) {
          return reply.code(error.statusCode).send(error.body);
        }
        if (error instanceof APIError) {
          return reply.code(error.statusCode).send({
            error: error.code,
            message: error.message,
            details: error.details,
          });
        }
        logger.error('Failed to sync posts', {
          error: error instanceof Error ? error.message : String(error),
          params: req.params,
        });
        return reply.code(500).send({
          error: 'sync_failed',
          message: error instanceof Error ? error.message : 'Failed to sync posts from platform',
        });
      }
    }
  );
}
