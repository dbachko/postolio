import { z } from 'zod';
import { logger as baseLogger } from '@postolio/logger';
import type { PlatformName } from '@postolio/connectors';

import { prisma } from '../../config/database.js';
import { ConnectorFactory } from '../../services/connectors/index.js';
import { assertBrandOwnership } from '../../services/ownership.js';
import { resolvePrimarySocialAccount } from '../../services/social-account-resolver.js';

export const logger = baseLogger.child({ module: 'social-platform-routes' });

export const OptionalSocialAccountBodySchema = z
  .object({
    socialAccountId: z.string().optional(),
  })
  .passthrough();

export const PlatformParamSchema = z.object({
  platform: z.string(),
  brandId: z.string(),
});

export const ContentIdSchema = z.object({
  platform: z.string(),
  contentId: z.string(),
});

export class SocialRouteReplyError extends Error {
  readonly statusCode: number;
  readonly body: Record<string, unknown>;

  constructor(statusCode: number, body: Record<string, unknown>) {
    const fallbackMessage =
      typeof body.message === 'string'
        ? body.message
        : typeof body.error === 'string'
          ? body.error
          : 'social_route_error';
    super(fallbackMessage);
    this.statusCode = statusCode;
    this.body = body;
  }
}

type BrandOwnershipOperation = 'status' | 'sync' | 'disconnect' | 'publish';

export function ensurePlatformSupported(platform: string) {
  if (!ConnectorFactory.supports(platform as PlatformName)) {
    return {
      statusCode: 400,
      body: {
        error: 'unsupported_platform',
        message: `Platform ${platform} is not yet supported`,
        supportedPlatforms: ConnectorFactory.supportedPlatforms(),
      },
    } as const;
  }
  return null;
}

function isDisconnected(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') {
    return false;
  }
  return Boolean((metadata as { disconnected?: unknown }).disconnected);
}

export async function assertBrandOwnershipWithAudit(opts: {
  req: any;
  userId: string;
  brandId: string;
  platform: string;
  operation: BrandOwnershipOperation;
}): Promise<void> {
  const { req, userId, brandId, platform, operation } = opts;

  try {
    await assertBrandOwnership(userId, brandId);
    return;
  } catch (error: unknown) {
    const apiError = error as { code?: string };
    if (apiError.code === 'BRAND_NOT_FOUND') {
      try {
        await prisma.auditLog.create({
          data: {
            userId,
            email: req.user!.email,
            eventType: 'social.unauthorized_access',
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            metadata: {
              brandId,
              platform,
              operation,
            },
            success: false,
          },
        });
      } catch (auditError: unknown) {
        logger.warn('Failed to create audit log', {
          error: auditError instanceof Error ? auditError.message : String(auditError),
        });
      }
    }

    throw error;
  }
}

export async function resolveSocialAccountForBrandPlatform(params: {
  brandId: string;
  platform: string;
  preferredSocialAccountId?: string | null;
}) {
  const preferredSocialAccountId = params.preferredSocialAccountId || null;

  if (!preferredSocialAccountId) {
    return resolvePrimarySocialAccount(params.brandId, params.platform);
  }

  const socialAccount = await prisma.socialAccount.findFirst({
    where: {
      id: preferredSocialAccountId,
      brandId: params.brandId,
      platform: params.platform as any,
    },
    select: {
      id: true,
      platform: true,
      externalAccountId: true,
      externalPageId: true,
      username: true,
      displayName: true,
      metadata: true,
    },
  });

  if (!socialAccount || isDisconnected(socialAccount.metadata)) {
    return null;
  }

  return {
    id: socialAccount.id,
    platform: String(socialAccount.platform),
    externalAccountId: socialAccount.externalAccountId,
    externalPageId: socialAccount.externalPageId,
    username: socialAccount.username,
    displayName: socialAccount.displayName,
    metadata: socialAccount.metadata,
  };
}
