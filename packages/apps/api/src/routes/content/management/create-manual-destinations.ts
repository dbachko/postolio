import type { FastifyReply } from 'fastify';

import { resolvePrimarySocialAccount } from '../../../services/social-account-resolver.js';
import { isMultiDestinationEnabledForUser } from '../../../utils/feature-flags.js';
import type { CreateManualContentBody } from '../../../utils/content-management.js';
import {
  type DestinationAccount,
  isDisconnected,
  prisma,
  sendMultiDestinationDisabled,
} from './shared.js';

function normalizeRequestedTargetIds(body: CreateManualContentBody): string[] | null {
  const raw = (body as { targetSocialAccountIds?: unknown }).targetSocialAccountIds;
  if (!Array.isArray(raw)) {
    return null;
  }

  return raw
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function resolveDestinationAccountIds(
  body: CreateManualContentBody,
  requestedTargetIds: string[] | null
): string[] | null {
  if (requestedTargetIds) {
    return requestedTargetIds;
  }
  if (body.targetSocialAccountId === undefined) {
    return null;
  }
  if (body.targetSocialAccountId === null || body.targetSocialAccountId === '') {
    return [];
  }
  return [body.targetSocialAccountId];
}

async function loadExplicitDestinations(
  brandId: string,
  destinationAccountIds: string[],
  reply: FastifyReply
): Promise<DestinationAccount[] | null> {
  const uniqueIds = Array.from(new Set(destinationAccountIds));
  if (uniqueIds.length === 0) {
    return [];
  }

  const accounts = await prisma.socialAccount.findMany({
    where: { brandId, id: { in: uniqueIds } },
    select: { id: true, platform: true, metadata: true },
  });

  const byId = new Map(accounts.map((account) => [account.id, account]));
  const invalid: string[] = [];
  const resolvedDestinations = uniqueIds
    .map((id) => {
      const match = byId.get(id);
      if (!match || isDisconnected(match.metadata)) {
        invalid.push(id);
        return null;
      }
      return { id: match.id, platform: String(match.platform), metadata: match.metadata };
    })
    .filter(Boolean) as DestinationAccount[];

  if (invalid.length > 0) {
    reply.code(400).send({
      error: 'invalid_target_social_account',
      message: 'One or more destination social accounts are not connected to this brand',
      details: invalid,
    });
    return null;
  }

  return resolvedDestinations;
}

async function loadFallbackDestination(brandId: string): Promise<DestinationAccount[]> {
  const primary = await resolvePrimarySocialAccount(brandId, 'instagram');
  if (!primary) {
    return [];
  }

  return [{ id: primary.id, platform: primary.platform, metadata: primary.metadata }];
}

function validateFeatureAccess(
  destinations: DestinationAccount[],
  multiDestinationEnabled: boolean,
  reply: FastifyReply
): boolean {
  if (multiDestinationEnabled) {
    return true;
  }

  if (destinations.length > 1) {
    sendMultiDestinationDisabled(reply);
    return false;
  }

  const nonInstagram = destinations.filter(
    (destination) => destination.platform.toLowerCase() !== 'instagram'
  );
  if (nonInstagram.length > 0) {
    reply.code(403).send({
      error: 'feature_disabled',
      code: 'PLATFORM_NOT_ENABLED',
      message: 'Only Instagram destinations are enabled for this account',
      details: nonInstagram.map((destination) => destination.id),
    });
    return false;
  }

  return true;
}

export async function resolveCreateDestinations(params: {
  body: CreateManualContentBody;
  userId: string;
  email?: string | null;
  reply: FastifyReply;
}): Promise<DestinationAccount[] | null> {
  const requestedTargetIds = normalizeRequestedTargetIds(params.body);
  const multiDestinationEnabled = isMultiDestinationEnabledForUser({
    userId: params.userId,
    email: params.email,
  });

  if (
    !multiDestinationEnabled &&
    Array.isArray(requestedTargetIds) &&
    requestedTargetIds.length > 1
  ) {
    sendMultiDestinationDisabled(params.reply);
    return null;
  }

  const destinationAccountIds = resolveDestinationAccountIds(params.body, requestedTargetIds);
  const resolvedDestinations = Array.isArray(destinationAccountIds)
    ? await loadExplicitDestinations(params.body.brandId, destinationAccountIds, params.reply)
    : await loadFallbackDestination(params.body.brandId);

  if (!resolvedDestinations) {
    return null;
  }

  const allowed = validateFeatureAccess(
    resolvedDestinations,
    multiDestinationEnabled,
    params.reply
  );
  return allowed ? resolvedDestinations : null;
}
