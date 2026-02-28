import type { FastifyInstance } from 'fastify';

import { assertBrandOwnership } from '../../services/ownership.js';
import { isMultiDestinationEnabledForUser } from '../../utils/feature-flags.js';

import { isDisconnected, normalizePreferences, normalizeStringArray, prisma } from './shared.js';

function keepOnlySupportedAccountIds(params: {
  requested: string[];
  accounts: Array<{ id: string; metadata: unknown; platform: unknown }>;
  multiDestinationEnabled: boolean;
}) {
  const allowedSet = new Set(
    params.accounts
      .filter((account) => !isDisconnected(account.metadata))
      .filter(
        (account) =>
          params.multiDestinationEnabled ||
          String(account.platform || '').toLowerCase() === 'instagram'
      )
      .map((account) => account.id)
  );
  const allowed = params.requested.filter((id) => allowedSet.has(id));

  if (!params.multiDestinationEnabled && allowed.length > 1) {
    return [allowed[0]!];
  }
  return allowed;
}

function createBrandSocialAccountsDefaultHandler() {
  return async (request: any, reply: any) => {
    const { brandId } = request.params as { brandId: string };
    const userId = request.user!.id;
    const email = (request.user as { email?: string } | undefined)?.email ?? null;

    const brand = await assertBrandOwnership(userId, brandId);
    const preferences = normalizePreferences(brand.preferences);
    const requested = normalizeStringArray(
      (request.body as { socialAccountIds?: unknown })?.socialAccountIds
    );
    const multiDestinationEnabled = isMultiDestinationEnabledForUser({ userId, email });

    let allowed: string[] = [];
    if (requested.length > 0) {
      const accounts = await prisma.socialAccount.findMany({
        where: { brandId, id: { in: requested } },
        select: { id: true, metadata: true, platform: true },
      });
      allowed = keepOnlySupportedAccountIds({
        requested,
        accounts,
        multiDestinationEnabled,
      });
    }

    await prisma.brand.update({
      where: { id: brandId },
      data: {
        preferences: {
          ...preferences,
          defaultPostSocialAccountIds: allowed,
        },
      },
    });

    return reply.send({
      success: true,
      brandId,
      defaultPostSocialAccountIds: allowed,
    });
  };
}

export function registerBrandSocialAccountsDefaultRoute(fastify: FastifyInstance) {
  fastify.post<{ Params: { brandId: string }; Body: { socialAccountIds?: unknown } }>(
    '/:brandId/social-accounts/default-post-social-accounts',
    { preHandler: fastify.authenticate },
    createBrandSocialAccountsDefaultHandler()
  );
}
