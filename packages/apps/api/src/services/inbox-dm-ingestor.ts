import { getDatabaseClient } from '../config/database.js';
import { instagramService } from './instagram.js';
import { PublisherCredentialsService } from './publisher-credentials.js';
import { logger as baseLogger } from '@postolio/logger';
import { formatError } from '../utils/logging.js';

const prisma = getDatabaseClient();
const logger = baseLogger.child({ module: 'inbox-dm-ingestor' });

type DmIngestStats = {
  accountsProcessed: number;
  threadsProcessed: number;
  conversationsUpserted: number;
  messagesInserted: number;
};

function safeDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}

function pickExternalParticipant(
  participants: any[],
  selfIds: Set<string>
): { participantExternalUserId: string; participantUsername: string } | null {
  const rows = Array.isArray(participants) ? participants : [];
  for (const participant of rows) {
    const id = String((participant as any)?.id || '').trim();
    if (!id || selfIds.has(id)) {
      continue;
    }

    const usernameRaw = (participant as any)?.username ?? (participant as any)?.name ?? null;
    const participantUsername =
      typeof usernameRaw === 'string' && usernameRaw.trim() ? usernameRaw : id;
    return { participantExternalUserId: id, participantUsername };
  }
  return null;
}

function emptyStats(): DmIngestStats {
  return {
    accountsProcessed: 0,
    threadsProcessed: 0,
    conversationsUpserted: 0,
    messagesInserted: 0,
  };
}

function mergeStats(target: DmIngestStats, next: Partial<DmIngestStats>) {
  target.accountsProcessed += next.accountsProcessed || 0;
  target.threadsProcessed += next.threadsProcessed || 0;
  target.conversationsUpserted += next.conversationsUpserted || 0;
  target.messagesInserted += next.messagesInserted || 0;
}

async function shouldSkipRecentlyIngestedAccount(params: {
  brandId: string;
  socialAccountId: string;
  minStaleMs: number;
  nowMs: number;
}) {
  if (params.minStaleMs <= 0) {
    return false;
  }

  const latest = await prisma.dMConversation.findFirst({
    where: {
      brandId: params.brandId,
      socialAccountId: params.socialAccountId,
      platform: 'instagram',
    },
    orderBy: { lastMessageAt: 'desc' },
    select: { lastMessageAt: true },
  });

  const lastMessageAt = latest?.lastMessageAt instanceof Date ? latest.lastMessageAt : null;
  return Boolean(lastMessageAt && params.nowMs - lastMessageAt.getTime() < params.minStaleMs);
}

async function fetchThreadsForAccount(params: {
  brandId: string;
  socialAccountId: string;
  maxThreads: number;
}) {
  try {
    return await instagramService.listDmThreadsForSocialAccount(params.socialAccountId, {
      limit: Math.max(1, Math.min(params.maxThreads, 50)),
    });
  } catch (error) {
    logger.warn('Failed to list Instagram DM threads', {
      brandId: params.brandId,
      socialAccountId: params.socialAccountId,
      ...formatError(error),
    });
    return null;
  }
}

async function resolveSelfIds(socialAccountId: string): Promise<Set<string>> {
  try {
    const creds = await PublisherCredentialsService.getCredentialsForSocialAccount(socialAccountId);
    return new Set(
      [String((creds as any)?.accountId || ''), String((creds as any)?.pageId || '')].filter(
        Boolean
      )
    );
  } catch {
    return new Set();
  }
}

async function upsertConversation(params: {
  brandId: string;
  socialAccountId: string;
  participantExternalUserId: string;
  participantUsername: string;
  threadUpdatedAt: Date;
}) {
  return prisma.dMConversation.upsert({
    where: {
      brandId_socialAccountId_platform_participantExternalUserId: {
        brandId: params.brandId,
        socialAccountId: params.socialAccountId,
        platform: 'instagram',
        participantExternalUserId: params.participantExternalUserId,
      },
    } as any,
    create: {
      brandId: params.brandId,
      socialAccountId: params.socialAccountId,
      platform: 'instagram',
      participantExternalUserId: params.participantExternalUserId,
      participantUsername: params.participantUsername,
      state: 'active',
      lastMessageAt: params.threadUpdatedAt,
    },
    update: {
      participantUsername: params.participantUsername,
      lastMessageAt: params.threadUpdatedAt,
    },
  });
}

async function fetchThreadMessages(params: {
  brandId: string;
  socialAccountId: string;
  threadId: string;
  perThreadLimit: number;
}) {
  try {
    return await instagramService.getDmThreadMessagesForSocialAccount(
      params.socialAccountId,
      params.threadId,
      {
        limit: Math.max(1, Math.min(params.perThreadLimit, 50)),
      }
    );
  } catch (error) {
    logger.warn('Failed to fetch Instagram DM thread messages', {
      brandId: params.brandId,
      socialAccountId: params.socialAccountId,
      threadId: params.threadId,
      ...formatError(error),
    });
    return null;
  }
}

type ParsedThreadMessage = {
  externalMessageId: string;
  messageText: string;
  createdAt: Date;
  direction: 'inbound' | 'outbound';
};

function parseThreadMessage(message: any, selfIds: Set<string>): ParsedThreadMessage | null {
  const externalMessageId = String((message as any)?.id || '').trim();
  const messageTextRaw = (message as any)?.message;
  const messageText = typeof messageTextRaw === 'string' ? messageTextRaw : null;
  if (!externalMessageId || !messageText) {
    return null;
  }

  const createdAt = safeDate((message as any)?.created_time) ?? new Date();
  const fromId = String((message as any)?.from?.id || '').trim();
  const direction: ParsedThreadMessage['direction'] =
    fromId && selfIds.has(fromId) ? 'outbound' : 'inbound';

  return {
    externalMessageId,
    messageText,
    createdAt,
    direction,
  };
}

function maxDate(left: Date | null, right: Date): Date {
  if (!left || right > left) {
    return right;
  }
  return left;
}

async function ingestThreadMessages(params: {
  conversationId: string;
  messages: any[];
  selfIds: Set<string>;
}) {
  let inserted = 0;
  let latestMessageAt: Date | null = null;

  for (const message of params.messages) {
    const parsedMessage = parseThreadMessage(message, params.selfIds);
    if (!parsedMessage) {
      continue;
    }

    latestMessageAt = maxDate(latestMessageAt, parsedMessage.createdAt);

    try {
      await prisma.dMMessage.create({
        data: {
          conversationId: params.conversationId,
          platform: 'instagram',
          direction: parsedMessage.direction,
          messageText: parsedMessage.messageText,
          externalMessageId: parsedMessage.externalMessageId,
          status: 'delivered',
          deliveredAt: parsedMessage.createdAt,
          createdAt: parsedMessage.createdAt,
        },
      });
      inserted += 1;
    } catch {
      // Unique constraint prevents duplicates.
    }
  }

  return { inserted, latestMessageAt };
}

async function processAccountThreads(params: {
  brandId: string;
  socialAccountId: string;
  maxThreads: number;
  perThreadLimit: number;
  minStaleMs: number;
  nowMs: number;
}) {
  const accountStats: Partial<DmIngestStats> = {
    threadsProcessed: 0,
    conversationsUpserted: 0,
    messagesInserted: 0,
  };

  const stale = await shouldSkipRecentlyIngestedAccount({
    brandId: params.brandId,
    socialAccountId: params.socialAccountId,
    minStaleMs: params.minStaleMs,
    nowMs: params.nowMs,
  });
  if (stale) {
    return accountStats;
  }

  const threadsRes = await fetchThreadsForAccount({
    brandId: params.brandId,
    socialAccountId: params.socialAccountId,
    maxThreads: params.maxThreads,
  });
  if (!threadsRes) {
    return accountStats;
  }
  if (!threadsRes.supported) {
    logger.info('Instagram DM threads not supported for social account', {
      brandId: params.brandId,
      socialAccountId: params.socialAccountId,
    });
    return accountStats;
  }

  const selfIds = await resolveSelfIds(params.socialAccountId);

  for (const thread of threadsRes.threads) {
    const threadStats = await processSingleThread({
      brandId: params.brandId,
      socialAccountId: params.socialAccountId,
      thread,
      selfIds,
      perThreadLimit: params.perThreadLimit,
    });
    mergeStats(accountStats as DmIngestStats, threadStats);
  }

  return accountStats;
}

async function processSingleThread(params: {
  brandId: string;
  socialAccountId: string;
  thread: any;
  selfIds: Set<string>;
  perThreadLimit: number;
}): Promise<Partial<DmIngestStats>> {
  const threadId = String(params.thread.id || '').trim();
  if (!threadId) {
    return {};
  }

  const participant = pickExternalParticipant(params.thread.participants || [], params.selfIds);
  if (!participant) {
    return {};
  }

  const threadUpdatedAt = safeDate((params.thread as any)?.updated_time) ?? new Date();
  const conversation = await upsertConversation({
    brandId: params.brandId,
    socialAccountId: params.socialAccountId,
    participantExternalUserId: participant.participantExternalUserId,
    participantUsername: participant.participantUsername,
    threadUpdatedAt,
  });

  const messagesRes = await fetchThreadMessages({
    brandId: params.brandId,
    socialAccountId: params.socialAccountId,
    threadId,
    perThreadLimit: params.perThreadLimit,
  });
  if (!messagesRes) {
    return { threadsProcessed: 1, conversationsUpserted: 1 };
  }
  if (!messagesRes.supported) {
    logger.info('Instagram DM thread messages not supported', {
      brandId: params.brandId,
      socialAccountId: params.socialAccountId,
      threadId,
    });
    return { threadsProcessed: 1, conversationsUpserted: 1 };
  }

  const messageIngestResult = await ingestThreadMessages({
    conversationId: conversation.id,
    messages: messagesRes.messages,
    selfIds: params.selfIds,
  });

  if (messageIngestResult.latestMessageAt) {
    try {
      await prisma.dMConversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: messageIngestResult.latestMessageAt },
      });
    } catch {
      // Best effort.
    }
  }

  return {
    threadsProcessed: 1,
    conversationsUpserted: 1,
    messagesInserted: messageIngestResult.inserted,
  };
}

/**
 * Ingest recent Instagram DM threads + messages for a brand into DMConversation/DMMessage tables.
 * This is a best-effort backfill so the inbox can display existing DMs even if webhooks were not
 * configured when the conversation started.
 */
export async function ingestBrandDMs(
  brandId: string,
  maxThreads = 25,
  perThreadLimit = 30,
  options?: { socialAccountIds?: string[]; minStaleMs?: number }
): Promise<DmIngestStats> {
  const brandExists = await prisma.brand.findUnique({
    where: { id: brandId },
    select: { id: true },
  });
  if (!brandExists) {
    throw new Error('Brand not found');
  }

  const socialAccountIds = (options?.socialAccountIds || []).map(String).filter(Boolean);
  const minStaleMs = Number(options?.minStaleMs ?? 0);
  const nowMs = Date.now();

  const accounts = await prisma.socialAccount.findMany({
    where: {
      brandId,
      platform: 'instagram',
      ...(socialAccountIds.length ? { id: { in: socialAccountIds } } : {}),
    },
    select: { id: true },
    orderBy: { sortOrder: 'asc' },
    take: 50,
  });

  const stats = emptyStats();
  for (const account of accounts) {
    stats.accountsProcessed += 1;
    const accountStats = await processAccountThreads({
      brandId,
      socialAccountId: account.id,
      maxThreads,
      perThreadLimit,
      minStaleMs,
      nowMs,
    });
    mergeStats(stats, accountStats);
  }

  return stats;
}
