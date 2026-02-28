import type { FastifyInstance } from 'fastify';
import type { PlatformName } from '@postolio/connectors';

import { ConnectorFactory } from '../../services/connectors/index.js';
import { resolvePrimarySocialAccount } from '../../services/social-account-resolver.js';
import {
  PlatformParamSchema,
  assertBrandOwnershipWithAudit,
  ensurePlatformSupported,
  logger,
} from './shared.js';

export function registerSocialStatusRoute(app: FastifyInstance) {
  app.get(
    '/api/social/:platform/status/:brandId',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        const { platform, brandId } = PlatformParamSchema.parse(req.params);
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
          operation: 'status',
        });

        const socialAccount = await resolvePrimarySocialAccount(brandId, platform);
        if (!socialAccount) {
          return reply.send({ connected: false, platform, account: null });
        }

        const connector = ConnectorFactory.get(platform as PlatformName);
        return reply.send({
          connected: true,
          platform,
          capabilities: connector.capabilities,
          account: {
            platform,
            id: socialAccount.id,
            username: socialAccount.username,
            displayName: socialAccount.displayName,
            externalAccountId: socialAccount.externalAccountId,
          },
        });
      } catch (error: unknown) {
        logger.error('Failed to get platform status', {
          error: error instanceof Error ? error.message : String(error),
          params: req.params,
        });
        throw error;
      }
    }
  );
}
