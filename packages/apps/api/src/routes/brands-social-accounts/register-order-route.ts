import type { FastifyInstance } from 'fastify';

import { assertBrandOwnership } from '../../services/ownership.js';
import { PublisherCredentialsService } from '../../services/publisher-credentials.js';

import { isDisconnected, normalizeStringArray, prisma } from './shared.js';

function buildConnectedOrder(params: {
  requested: string[];
  accounts: Array<{ id: string; metadata: unknown }>;
}) {
  const accountById = new Map(params.accounts.map((account) => [account.id, account]));
  const brandConnectedIds = params.accounts
    .filter((account) => !isDisconnected(account.metadata))
    .map((account) => account.id);
  const nextConnectedIds: string[] = [];

  for (const id of params.requested) {
    const account = accountById.get(id);
    if (!account || isDisconnected(account.metadata)) {
      continue;
    }
    nextConnectedIds.push(id);
  }
  for (const id of brandConnectedIds) {
    if (!nextConnectedIds.includes(id)) {
      nextConnectedIds.push(id);
    }
  }

  return nextConnectedIds;
}

async function persistConnectedOrder(orderedIds: string[]) {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.socialAccount.update({
        where: { id },
        data: { sortOrder: index },
      })
    )
  );
}

function createBrandSocialAccountsOrderHandler() {
  return async (request: any, reply: any) => {
    const { brandId } = request.params as { brandId: string };
    const userId = request.user!.id;
    await assertBrandOwnership(userId, brandId);

    const rawOrderedIds = (request.body as { orderedIds?: unknown } | undefined)?.orderedIds;
    if (!Array.isArray(rawOrderedIds)) {
      return reply.code(400).send({ error: 'invalid_ordered_ids' });
    }

    const requested = normalizeStringArray(rawOrderedIds);
    const accounts = await prisma.socialAccount.findMany({
      where: { brandId },
      select: { id: true, metadata: true, sortOrder: true, createdAt: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const orderedIds = buildConnectedOrder({ requested, accounts });
    await persistConnectedOrder(orderedIds);

    try {
      await PublisherCredentialsService.invalidateCredentialsCache(brandId);
    } catch {
      // best effort
    }

    return reply.send({ success: true, brandId, orderedIds });
  };
}

export function registerBrandSocialAccountsOrderRoute(fastify: FastifyInstance) {
  fastify.post<{ Params: { brandId: string }; Body: { orderedIds?: unknown } }>(
    '/:brandId/social-accounts/order',
    { preHandler: fastify.authenticate },
    createBrandSocialAccountsOrderHandler()
  );
}
