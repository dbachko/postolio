import type { Prisma } from '@postolio/database';

import { PublisherCredentialsService } from '../../services/publisher-credentials.js';
import { ensureDefaultQueueWithStarterSchedule } from '../../services/publishing-queue/default-schedule.js';
import { type getTokenService } from '../../services/service-clients.js';
import { isMultiDestinationEnabledForUser } from '../../utils/feature-flags.js';

import {
  buildRedisKeys,
  isMetadataDisconnected,
  type FinalizeBody,
  type MetaConnectCandidate,
  type MetaConnectCandidateToken,
  type MetaConnectSession,
  prisma,
  redisService,
} from './shared.js';

export type FinalizeError = {
  statusCode: number;
  body: Record<string, unknown>;
};

export type ConnectedAccount = {
  socialAccountId: string;
  platform: 'instagram' | 'facebook';
  candidate: MetaConnectCandidate;
};

export function parseFinalizeInput(body: unknown) {
  const parsed = (body || {}) as FinalizeBody;
  const connectSessionId = parsed.connectSessionId;
  const candidateIds = Array.isArray(parsed.candidateIds) ? parsed.candidateIds : [];

  if (!connectSessionId) {
    return {
      error: {
        statusCode: 400,
        body: { error: 'connectSessionId is required' },
      } satisfies FinalizeError,
    };
  }
  if (!candidateIds.length) {
    return {
      error: {
        statusCode: 400,
        body: { error: 'candidateIds must not be empty' },
      } satisfies FinalizeError,
    };
  }

  return { connectSessionId, candidateIds };
}

export async function loadFinalizeSession(connectSessionId: string) {
  const { sessionKey } = buildRedisKeys(connectSessionId);
  const rawSession = await redisService.get(sessionKey);
  if (!rawSession) {
    return null;
  }
  return JSON.parse(rawSession) as MetaConnectSession;
}

export async function loadCandidatesAndTokens(connectSessionId: string) {
  const { candidatesKey, tokensKey } = buildRedisKeys(connectSessionId);
  const [rawCandidates, rawTokens] = await Promise.all([
    redisService.get(candidatesKey),
    redisService.get(tokensKey),
  ]);
  if (!rawCandidates || !rawTokens) {
    return null;
  }

  return {
    parsedCandidates: JSON.parse(rawCandidates) as {
      candidates: MetaConnectCandidate[];
      expiresAt?: string;
    },
    tokens: JSON.parse(rawTokens) as Record<string, MetaConnectCandidateToken>,
  };
}

export function selectCandidates(params: {
  candidateIds: string[];
  parsedCandidates: { candidates: MetaConnectCandidate[] };
}) {
  const candidatesById = new Map(
    params.parsedCandidates.candidates.map((candidate) => [candidate.candidateId, candidate])
  );
  const selected: MetaConnectCandidate[] = [];

  for (const id of params.candidateIds) {
    const candidate = candidatesById.get(id);
    if (!candidate) {
      return {
        error: {
          statusCode: 400,
          body: { error: 'invalid_candidate', candidateId: id },
        } satisfies FinalizeError,
      };
    }
    selected.push(candidate);
  }

  return { selected };
}

async function enforceSingleDestinationPolicy(params: {
  selectedCandidates: MetaConnectCandidate[];
  brandId: string;
}) {
  const nonInstagram = params.selectedCandidates.filter(
    (candidate) => candidate.platform !== 'instagram'
  );
  if (nonInstagram.length > 0) {
    return {
      statusCode: 403,
      body: {
        error: 'feature_disabled',
        code: 'MULTI_DESTINATION_DISABLED',
        message: 'Only Instagram destinations are enabled for this account',
      },
    } satisfies FinalizeError;
  }
  if (params.selectedCandidates.length > 1) {
    return {
      statusCode: 400,
      body: {
        error: 'too_many_destinations',
        code: 'MULTI_DESTINATION_DISABLED',
        message: 'Only one Instagram account can be connected when multi-destination is disabled',
      },
    } satisfies FinalizeError;
  }

  const selectedInstagram = params.selectedCandidates[0] || null;
  if (!selectedInstagram) {
    return null;
  }

  const existingInstagramAccounts = await prisma.socialAccount.findMany({
    where: { brandId: params.brandId, platform: 'instagram' as any },
    select: { externalAccountId: true, metadata: true },
  });
  const connected = existingInstagramAccounts.filter(
    (account) => !isMetadataDisconnected(account.metadata)
  );
  if (!connected.length) {
    return null;
  }

  const allowedExternalIds = new Set(connected.map((account) => account.externalAccountId));
  if (allowedExternalIds.has(selectedInstagram.externalAccountId)) {
    return null;
  }

  return {
    statusCode: 403,
    body: {
      error: 'feature_disabled',
      code: 'MULTI_DESTINATION_DISABLED',
      message: 'Only one Instagram account can be connected when multi-destination is disabled',
    },
  } satisfies FinalizeError;
}

export async function validateCandidateSelectionPolicy(params: {
  userId: string;
  email?: string | null;
  brandId: string;
  selectedCandidates: MetaConnectCandidate[];
}) {
  const multiDestinationEnabled = isMultiDestinationEnabledForUser({
    userId: params.userId,
    email: params.email ?? null,
  });
  if (multiDestinationEnabled) {
    return null;
  }
  return enforceSingleDestinationPolicy({
    selectedCandidates: params.selectedCandidates,
    brandId: params.brandId,
  });
}

export async function findCrossBrandConflict(params: {
  selectedCandidates: MetaConnectCandidate[];
  brandId: string;
}) {
  const existing = await prisma.socialAccount.findMany({
    where: {
      OR: params.selectedCandidates.map((candidate) => ({
        platform: candidate.platform as any,
        externalAccountId: candidate.externalAccountId,
      })),
    },
    select: { brandId: true, platform: true, externalAccountId: true },
  });
  return existing.find((row) => row.brandId !== params.brandId) || null;
}

export async function loadOwnedBrand(brandId: string) {
  return prisma.brand.findUnique({
    where: { id: brandId },
    select: { id: true, userId: true, preferences: true },
  });
}

function buildCandidateMetadata(params: {
  candidate: MetaConnectCandidate;
  token: MetaConnectCandidateToken | undefined;
  fallbackExpiresAt?: string;
  tokenUpdatedAt: string;
}) {
  const candidateMetadata = params.candidate.metadata
    ? (JSON.parse(JSON.stringify(params.candidate.metadata)) as Record<string, unknown>)
    : {};
  const tokenExpiresAt =
    params.token && typeof params.token.expiresAt === 'string' && params.token.expiresAt.trim()
      ? params.token.expiresAt
      : params.fallbackExpiresAt || null;
  const merged: Record<string, unknown> = {
    ...candidateMetadata,
    ...(tokenExpiresAt ? { tokenExpiresAt } : {}),
    tokenUpdatedAt: params.tokenUpdatedAt,
  };
  return JSON.parse(JSON.stringify(merged)) as Prisma.InputJsonValue;
}

async function upsertCandidateAccount(params: {
  tx: Prisma.TransactionClient;
  candidate: MetaConnectCandidate;
  brandId: string;
  tokens: Record<string, MetaConnectCandidateToken>;
  fallbackExpiresAt?: string;
  tokenUpdatedAt: string;
  sortOrder: { value: number };
}) {
  const existingAccount = await params.tx.socialAccount.findUnique({
    where: {
      platform_externalAccountId: {
        platform: params.candidate.platform as any,
        externalAccountId: params.candidate.externalAccountId,
      },
    },
    select: { id: true, brandId: true },
  });
  if (existingAccount && existingAccount.brandId !== params.brandId) {
    throw new Error('account_already_connected_other_brand');
  }

  const metadata = buildCandidateMetadata({
    candidate: params.candidate,
    token: params.tokens[params.candidate.candidateId],
    fallbackExpiresAt: params.fallbackExpiresAt,
    tokenUpdatedAt: params.tokenUpdatedAt,
  });

  if (!existingAccount) {
    params.sortOrder.value += 1;
    const created = await params.tx.socialAccount.create({
      data: {
        brandId: params.brandId,
        platform: params.candidate.platform as any,
        externalAccountId: params.candidate.externalAccountId,
        externalPageId: params.candidate.externalPageId || null,
        username: params.candidate.username || null,
        displayName: params.candidate.displayName || null,
        metadata,
        sortOrder: params.sortOrder.value,
      },
      select: { id: true },
    });
    return {
      socialAccountId: created.id,
      platform: params.candidate.platform,
      candidate: params.candidate,
    };
  }

  const updated = await params.tx.socialAccount.update({
    where: { id: existingAccount.id },
    data: {
      externalPageId: params.candidate.externalPageId || null,
      username: params.candidate.username || null,
      displayName: params.candidate.displayName || null,
      metadata,
    },
    select: { id: true },
  });
  return {
    socialAccountId: updated.id,
    platform: params.candidate.platform,
    candidate: params.candidate,
  };
}

export async function upsertSelectedAccounts(params: {
  brandId: string;
  selectedCandidates: MetaConnectCandidate[];
  parsedCandidates: { expiresAt?: string };
  tokens: Record<string, MetaConnectCandidateToken>;
}) {
  return prisma.$transaction(async (tx) => {
    const aggregate = await tx.socialAccount.aggregate({
      where: { brandId: params.brandId },
      _max: { sortOrder: true },
    });
    const sortOrder = {
      value: typeof aggregate._max.sortOrder === 'number' ? aggregate._max.sortOrder : -1,
    };
    const tokenUpdatedAt = new Date().toISOString();
    const connected: ConnectedAccount[] = [];

    for (const candidate of params.selectedCandidates) {
      connected.push(
        await upsertCandidateAccount({
          tx,
          candidate,
          brandId: params.brandId,
          tokens: params.tokens,
          fallbackExpiresAt: params.parsedCandidates.expiresAt,
          tokenUpdatedAt,
          sortOrder,
        })
      );
    }

    const ensured = new Set<string>();
    for (const account of connected) {
      if (ensured.has(account.socialAccountId)) {
        continue;
      }
      ensured.add(account.socialAccountId);
      await ensureDefaultQueueWithStarterSchedule(tx, account.socialAccountId);
    }

    return connected;
  });
}

export async function storeTokensForConnectedAccounts(params: {
  tokenClient: Awaited<ReturnType<typeof getTokenService>>;
  brand: { id: string; userId: string };
  connected: ConnectedAccount[];
  tokens: Record<string, MetaConnectCandidateToken>;
}) {
  for (const account of params.connected) {
    const token = params.tokens[account.candidate.candidateId];
    if (!token?.accessToken) {
      continue;
    }
    await params.tokenClient.storeTokenForSocialAccount({
      userId: params.brand.userId,
      brandId: params.brand.id,
      platform: account.platform,
      socialAccountId: account.socialAccountId,
      accessToken: token.accessToken,
      expiresAt: new Date(token.expiresAt),
      metadata: token.metadata,
    });
  }
}

export async function invalidateCredentialsCache(brandId: string) {
  try {
    await PublisherCredentialsService.invalidateCredentialsCache(brandId);
  } catch {
    // best effort
  }
}

export async function cleanupConnectSession(connectSessionId: string, state?: string) {
  const { candidatesKey, tokensKey, sessionKey, stateKey } = buildRedisKeys(
    connectSessionId,
    state
  );
  await Promise.all([
    redisService.del(candidatesKey),
    redisService.del(tokensKey),
    redisService.del(sessionKey),
    stateKey ? redisService.del(stateKey) : Promise.resolve(),
  ]);
}

export async function loadBrandSocialAccounts(brandId: string) {
  return prisma.socialAccount.findMany({
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
}
