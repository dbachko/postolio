import type { FastifyInstance } from 'fastify';

import { resolvePrimarySocialAccount } from '../../services/social-account-resolver.js';
import {
  PlatformParamSchema,
  assertBrandOwnershipWithAudit,
  ensurePlatformSupported,
  logger,
  SocialRouteReplyError,
} from './shared.js';
import {
  auditDisconnectSuccess,
  deleteDisconnectedPlatformToken,
  markSocialAccountDisconnected,
  removeImportedPostsForDisconnectedAccount,
} from './disconnect-helpers.js';

async function runDisconnectFlow(params: {
  req: any;
  userId: string;
  platform: string;
  brandId: string;
  removeImportedPosts: boolean;
}) {
  const socialAccount = await resolvePrimarySocialAccount(params.brandId, params.platform);
  if (!socialAccount) {
    throw new SocialRouteReplyError(404, {
      error: 'platform_not_connected',
      message: `Brand does not have ${params.platform} connected`,
    });
  }

  await markSocialAccountDisconnected(socialAccount.id, socialAccount.metadata);
  if (params.removeImportedPosts) {
    try {
      const removedCount = await removeImportedPostsForDisconnectedAccount({
        platform: params.platform,
        brandId: params.brandId,
        socialAccountId: socialAccount.id,
      });
      if (removedCount > 0) {
        logger.info('Removed imported posts for disconnected social account', {
          platform: params.platform,
          brandId: params.brandId,
          socialAccountId: socialAccount.id,
          removedCount,
        });
      }
    } catch (error: unknown) {
      logger.warn('Failed to remove imported posts on social disconnect', {
        error: error instanceof Error ? error.message : String(error),
        platform: params.platform,
        brandId: params.brandId,
      });
    }
  }

  await deleteDisconnectedPlatformToken({
    userId: params.userId,
    brandId: params.brandId,
    platform: params.platform,
    socialAccountId: socialAccount.id,
  });

  await auditDisconnectSuccess({
    req: params.req,
    userId: params.userId,
    brandId: params.brandId,
    platform: params.platform,
    externalAccountId: socialAccount.externalAccountId,
    username: socialAccount.username,
  });

  logger.info('Platform disconnected', {
    platform: params.platform,
    brandId: params.brandId,
  });

  return {
    success: true,
    platform: params.platform,
    message: `${params.platform} disconnected successfully`,
  };
}

export function registerSocialDisconnectRoute(app: FastifyInstance) {
  app.post(
    '/api/social/:platform/disconnect/:brandId',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        const { platform, brandId } = PlatformParamSchema.parse(req.params);
        const userId = req.user!.id;
        const body = (req.body || {}) as { removeImportedPosts?: boolean };

        const platformError = ensurePlatformSupported(platform);
        if (platformError) {
          return reply.code(platformError.statusCode).send(platformError.body);
        }

        await assertBrandOwnershipWithAudit({
          req,
          userId,
          brandId,
          platform,
          operation: 'disconnect',
        });

        const response = await runDisconnectFlow({
          req,
          userId,
          platform,
          brandId,
          removeImportedPosts: body.removeImportedPosts === true,
        });
        return reply.send(response);
      } catch (error: unknown) {
        if (error instanceof SocialRouteReplyError) {
          return reply.code(error.statusCode).send(error.body);
        }
        logger.error('Failed to disconnect platform', {
          error: error instanceof Error ? error.message : String(error),
          params: req.params,
        });
        throw error;
      }
    }
  );
}
