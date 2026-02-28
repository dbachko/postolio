import type { FastifyInstance } from 'fastify';

import {
  OptionalSocialAccountBodySchema,
  ContentIdSchema,
  ensurePlatformSupported,
  logger,
  SocialRouteReplyError,
} from './shared.js';
import {
  assertPublishPermission,
  auditPublishSuccess,
  broadcastPublishStatus,
  fetchContentForPublish,
  publishToConnector,
  resolvePublishTarget,
  savePublishSuccess,
  validateCaptionLength,
} from './publish-helpers.js';

function resolvePreferredSocialAccountId(content: any, requestSocialAccountId?: string | null) {
  if (requestSocialAccountId) {
    return requestSocialAccountId;
  }
  return typeof content?.targetSocialAccountId === 'string'
    ? (content.targetSocialAccountId as string)
    : null;
}

function sendPublishSuccess(reply: any, platform: string, publishResult: any) {
  return reply.send({
    success: true,
    platform,
    externalPostId: publishResult.externalPostId,
    permalink: publishResult.permalink,
    publication: {
      externalPostId: publishResult.externalPostId,
      permalink: publishResult.permalink,
      publishedAt: publishResult.publishedAt,
    },
  });
}

async function runPublishFlow(params: {
  req: any;
  reply: any;
  platform: string;
  contentId: string;
  userId: string;
  requestedSocialAccountId?: string;
}) {
  const content = await fetchContentForPublish(params.contentId);
  if (!content) {
    throw new SocialRouteReplyError(404, {
      error: 'content_not_found',
      message: `Content ${params.contentId} not found`,
    });
  }

  await assertPublishPermission({
    req: params.req,
    content,
    contentId: params.contentId,
    platform: params.platform,
    userId: params.userId,
  });

  validateCaptionLength(params.platform, content.caption || '');
  const preferredSocialAccountId = resolvePreferredSocialAccountId(
    content,
    params.requestedSocialAccountId
  );
  const publishTarget = await resolvePublishTarget({
    brandId: content.brandId,
    platform: params.platform,
    preferredSocialAccountId,
    userId: content.brand.userId,
  });

  const publishResult = await publishToConnector({
    content,
    connector: publishTarget.connector,
    tokens: publishTarget.tokens,
    socialAccount: publishTarget.socialAccount,
    platform: params.platform,
  });

  await savePublishSuccess({
    contentId: params.contentId,
    content,
    platform: params.platform,
    socialAccountId: publishTarget.socialAccount.id,
    publishResult,
  });

  await broadcastPublishStatus({
    content,
    contentId: params.contentId,
    platform: params.platform,
    publishResult,
  });

  await auditPublishSuccess({
    req: params.req,
    userId: content.brand.userId,
    brandId: content.brandId,
    platform: params.platform,
    contentId: params.contentId,
    externalPostId: publishResult.externalPostId,
    permalink: publishResult.permalink,
  });

  return sendPublishSuccess(params.reply, params.platform, publishResult);
}

export function registerSocialPublishRoute(app: FastifyInstance) {
  app.post(
    '/api/social/:platform/publish/:contentId',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        const { platform, contentId } = ContentIdSchema.parse(req.params);
        const body = OptionalSocialAccountBodySchema.parse((req.body || {}) as unknown);
        const userId = req.user!.id;

        const platformError = ensurePlatformSupported(platform);
        if (platformError) {
          return reply.code(platformError.statusCode).send(platformError.body);
        }

        logger.info('Publishing content', { contentId, platform });
        return await runPublishFlow({
          req,
          reply,
          platform,
          contentId,
          userId,
          requestedSocialAccountId: body.socialAccountId,
        });
      } catch (error: unknown) {
        if (error instanceof SocialRouteReplyError) {
          return reply.code(error.statusCode).send(error.body);
        }
        logger.error('Failed to publish content', {
          error: error instanceof Error ? error.message : String(error),
          params: req.params,
        });
        return reply.code(500).send({
          error: 'publish_failed',
          message: error instanceof Error ? error.message : 'Failed to publish content',
        });
      }
    }
  );
}
