import type { FastifyInstance } from 'fastify';

import { assertBrandOwnership } from '../../services/ownership.js';
import { isMultiDestinationEnabledForUser } from '../../utils/feature-flags.js';

import {
  computeTokenStatus,
  isDisconnected,
  normalizeDefaultPostSocialAccountIds,
  normalizePreferences,
  prisma,
  resolveProfilePictureUrl,
} from './shared.js';

function isAllowedPlatform(platform: unknown, multiDestinationEnabled: boolean) {
  if (multiDestinationEnabled) {
    return true;
  }
  return String(platform || '').toLowerCase() === 'instagram';
}

function mapSocialAccountItem(account: any) {
  const disconnected = isDisconnected(account.metadata);
  const token = computeTokenStatus(account.metadata);
  return {
    id: account.id,
    platform: account.platform,
    externalAccountId: account.externalAccountId,
    externalPageId: account.externalPageId,
    username: account.username,
    displayName: account.displayName,
    profilePictureUrl: resolveProfilePictureUrl(account.metadata),
    disconnected,
    tokenStatus: token.tokenStatus,
    tokenExpiresAt: token.tokenExpiresAt,
    metadata: account.metadata,
    sortOrder: account.sortOrder,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function normalizeDefaultIds(params: {
  defaults: string[];
  items: Array<{ id: string; disconnected: boolean; platform: unknown }>;
  multiDestinationEnabled: boolean;
}) {
  const itemById = new Map(params.items.map((item) => [item.id, item]));
  const filtered = params.defaults.filter((id) => {
    const item = itemById.get(id);
    if (!item || item.disconnected) {
      return false;
    }
    return isAllowedPlatform(item.platform, params.multiDestinationEnabled);
  });

  if (!params.multiDestinationEnabled && filtered.length > 1) {
    return [filtered[0]!];
  }
  return filtered;
}

function resolvePrimarySocialAccountId(params: {
  items: Array<{ id: string; disconnected: boolean; platform: unknown }>;
  multiDestinationEnabled: boolean;
}) {
  return (
    params.items.find(
      (item) =>
        !item.disconnected && isAllowedPlatform(item.platform, params.multiDestinationEnabled)
    )?.id ?? null
  );
}

function createBrandSocialAccountsListHandler() {
  return async (request: any, reply: any) => {
    const { brandId } = request.params as { brandId: string };
    const userId = request.user!.id;
    const email = (request.user as { email?: string } | undefined)?.email ?? null;

    const brand = await assertBrandOwnership(userId, brandId);
    const preferences = normalizePreferences(brand.preferences);
    const defaults = normalizeDefaultPostSocialAccountIds(preferences);
    const multiDestinationEnabled = isMultiDestinationEnabledForUser({ userId, email });

    const socialAccounts = await prisma.socialAccount.findMany({
      where: { brandId },
      select: {
        id: true,
        platform: true,
        externalAccountId: true,
        externalPageId: true,
        username: true,
        displayName: true,
        metadata: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    const items = socialAccounts.map(mapSocialAccountItem);
    const normalizedDefaultPostIds = normalizeDefaultIds({
      defaults,
      items,
      multiDestinationEnabled,
    });
    const primarySocialAccountId = resolvePrimarySocialAccountId({
      items,
      multiDestinationEnabled,
    });

    return reply.send({
      brandId,
      primarySocialAccountId,
      defaultPostSocialAccountIds: normalizedDefaultPostIds,
      socialAccounts: items,
    });
  };
}

export function registerBrandSocialAccountsListRoute(fastify: FastifyInstance) {
  fastify.get<{ Params: { brandId: string } }>(
    '/:brandId/social-accounts',
    { preHandler: fastify.authenticate },
    createBrandSocialAccountsListHandler()
  );
}
