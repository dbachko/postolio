import type { FastifyInstance } from 'fastify';

import { PublisherCredentialsService } from '../../services/publisher-credentials.js';
import { getTokenService } from '../../services/service-clients.js';

import { prisma } from './shared.js';

async function loadOwnedBrand(brandId: string, userId: string) {
  return prisma.brand.findFirst({
    where: { id: brandId, userId },
    select: { id: true, userId: true },
  });
}

async function loadBrandSocialAccount(brandId: string, socialAccountId: string) {
  return prisma.socialAccount.findFirst({
    where: { id: socialAccountId, brandId },
    select: {
      id: true,
      platform: true,
      metadata: true,
    },
  });
}

async function markSocialAccountDisconnected(socialAccountId: string, metadata: unknown) {
  const existingMetadata =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
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

async function removeImportedPosts(params: {
  brandId: string;
  socialAccountId: string;
  platform: string;
}) {
  const source = params.platform === 'instagram' ? 'instagram_import' : `${params.platform}_import`;
  const importedContent = await prisma.content.findMany({
    where: {
      brandId: params.brandId,
      generationParams: { path: ['source'], equals: source },
      publications: {
        some: { socialAccountId: params.socialAccountId, platform: params.platform as any },
      },
    },
    select: { id: true },
  });
  const importedIds = importedContent.map((content) => content.id);
  if (importedIds.length > 0) {
    await prisma.content.deleteMany({ where: { id: { in: importedIds } } });
  }
}

async function deleteTokenBestEffort(params: {
  userId: string;
  brandId: string;
  platform: string;
  socialAccountId: string;
  log: any;
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
    params.log.warn({ err: error }, 'Failed to delete account token during disconnect');
  }
}

async function invalidatePublisherCredentialsCacheBestEffort(brandId: string) {
  try {
    await PublisherCredentialsService.invalidateCredentialsCache(brandId);
  } catch {
    // best effort
  }
}

function createBrandSocialAccountsDisconnectHandler() {
  return async (request: any, reply: any) => {
    const { brandId, socialAccountId } = request.params as {
      brandId: string;
      socialAccountId: string;
    };
    const removeImportedPostsEnabled =
      (request.body as { removeImportedPosts?: unknown } | undefined)?.removeImportedPosts === true;
    const userId = request.user!.id;

    const brand = await loadOwnedBrand(brandId, userId);
    if (!brand) {
      return reply.code(404).send({ error: 'brand_not_found' });
    }

    const socialAccount = await loadBrandSocialAccount(brandId, socialAccountId);
    if (!socialAccount) {
      return reply.code(404).send({ error: 'social_account_not_found' });
    }

    await markSocialAccountDisconnected(socialAccountId, socialAccount.metadata);
    await deleteTokenBestEffort({
      userId: brand.userId,
      brandId: brand.id,
      platform: String(socialAccount.platform),
      socialAccountId,
      log: request.log,
    });
    await invalidatePublisherCredentialsCacheBestEffort(brandId);

    if (removeImportedPostsEnabled) {
      try {
        await removeImportedPosts({
          brandId,
          socialAccountId,
          platform: String(socialAccount.platform),
        });
      } catch (error: unknown) {
        request.log.warn({ err: error }, 'Failed to remove imported posts on disconnect');
      }
    }

    return reply.send({ success: true, brandId, socialAccountId });
  };
}

export function registerBrandSocialAccountsDisconnectRoute(fastify: FastifyInstance) {
  fastify.post<{
    Params: { brandId: string; socialAccountId: string };
    Body: { removeImportedPosts?: boolean };
  }>(
    '/:brandId/social-accounts/:socialAccountId/disconnect',
    { preHandler: fastify.authenticate },
    createBrandSocialAccountsDisconnectHandler()
  );
}
