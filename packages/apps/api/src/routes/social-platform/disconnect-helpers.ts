import { prisma } from '../../config/database.js';
import { getTokenService } from '../../services/service-clients.js';
import { logger } from './shared.js';

export async function markSocialAccountDisconnected(socialAccountId: string, metadata: unknown) {
  const existingMetadata =
    metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {};

  await prisma.socialAccount.update({
    where: { id: socialAccountId },
    data: {
      metadata: {
        ...existingMetadata,
        disconnected: true,
        disconnectedAt: new Date().toISOString(),
      },
    },
  });
}

export async function removeImportedPostsForDisconnectedAccount(params: {
  platform: string;
  brandId: string;
  socialAccountId: string;
}) {
  const sourceValue =
    params.platform === 'instagram' ? 'instagram_import' : `${params.platform}_import`;

  const importedContent = await prisma.content.findMany({
    where: {
      brandId: params.brandId,
      generationParams: {
        path: ['source'],
        equals: sourceValue,
      },
      publications: {
        some: {
          socialAccountId: params.socialAccountId,
          platform: params.platform as any,
        },
      },
    },
    select: { id: true },
  });

  const importedIds = importedContent.map((content) => content.id);
  if (importedIds.length === 0) {
    return 0;
  }

  await prisma.content.deleteMany({
    where: { id: { in: importedIds } },
  });
  return importedIds.length;
}

export async function deleteDisconnectedPlatformToken(params: {
  userId: string;
  brandId: string;
  platform: string;
  socialAccountId: string;
}) {
  try {
    const tokenService = await getTokenService();
    await tokenService.deleteTokenForSocialAccount(
      params.userId,
      params.brandId,
      params.platform,
      params.socialAccountId
    );
  } catch (error: unknown) {
    logger.warn('Failed to delete token for disconnected platform', {
      error: error instanceof Error ? error.message : String(error),
      platform: params.platform,
      brandId: params.brandId,
      socialAccountId: params.socialAccountId,
    });
  }
}

export async function auditDisconnectSuccess(params: {
  req: any;
  userId: string;
  brandId: string;
  platform: string;
  externalAccountId?: string | null;
  username?: string | null;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        email: params.req.user!.email,
        eventType: 'social.platform_disconnected',
        ipAddress: params.req.ip,
        userAgent: params.req.headers['user-agent'],
        metadata: {
          brandId: params.brandId,
          platform: params.platform,
          accountId: params.externalAccountId,
          username: params.username,
        },
        success: true,
      },
    });
  } catch (error: unknown) {
    logger.warn('Failed to create audit log', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
