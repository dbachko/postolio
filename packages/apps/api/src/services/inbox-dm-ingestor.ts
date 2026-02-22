import { getDatabaseClient } from '../config/database.js';
import { instagramService } from './instagram.js';
import { PublisherCredentialsService } from './publisher-credentials.js';
import { logger as baseLogger } from '@postolio/logger';
import { formatError } from '../utils/logging.js';

const prisma = getDatabaseClient();
const logger = baseLogger.child({ module: 'inbox-dm-ingestor' });

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
  for (const p of rows) {
    const id = String((p as any)?.id || '').trim();
    if (!id || selfIds.has(id)) {
      continue;
    }
    const usernameRaw = (p as any)?.username ?? (p as any)?.name ?? null;
    const participantUsername =
      typeof usernameRaw === 'string' && usernameRaw.trim() ? usernameRaw : id;
    return { participantExternalUserId: id, participantUsername };
  }
  return null;
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
): Promise<{
  accountsProcessed: number;
  threadsProcessed: number;
  conversationsUpserted: number;
  messagesInserted: number;
}> {
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

  let accountsProcessed = 0;
  let threadsProcessed = 0;
  let conversationsUpserted = 0;
  let messagesInserted = 0;

  for (const account of accounts) {
    accountsProcessed++;

    // Best-effort throttle per account: skip if we've ingested this account very recently.
    if (minStaleMs > 0) {
      const latest = await prisma.dMConversation.findFirst({
        where: { brandId, socialAccountId: account.id, platform: 'instagram' },
        orderBy: { lastMessageAt: 'desc' },
        select: { lastMessageAt: true },
      });
      const lastMessageAt = latest?.lastMessageAt instanceof Date ? latest.lastMessageAt : null;
      if (lastMessageAt && nowMs - lastMessageAt.getTime() < minStaleMs) {
        continue;
      }
    }

    let threadsRes: Awaited<ReturnType<typeof instagramService.listDmThreadsForSocialAccount>>;
    try {
      threadsRes = await instagramService.listDmThreadsForSocialAccount(account.id, {
        limit: Math.max(1, Math.min(maxThreads, 50)),
      });
    } catch (error) {
      logger.warn('Failed to list Instagram DM threads', {
        brandId,
        socialAccountId: account.id,
        ...formatError(error),
      });
      continue;
    }
    if (!threadsRes.supported) {
      logger.info('Instagram DM threads not supported for social account', {
        brandId,
        socialAccountId: account.id,
      });
      continue;
    }

    // Determine "self" ids to distinguish inbound vs outbound.
    let selfIds = new Set<string>();
    try {
      const creds = await PublisherCredentialsService.getCredentialsForSocialAccount(account.id);
      selfIds = new Set(
        [String((creds as any)?.accountId || ''), String((creds as any)?.pageId || '')].filter(
          Boolean
        )
      );
    } catch {
      selfIds = new Set();
    }

    for (const t of threadsRes.threads) {
      const threadId = String(t.id || '').trim();
      if (!threadId) {
        continue;
      }

      const picked = pickExternalParticipant(t.participants || [], selfIds);
      if (!picked) {
        continue;
      }

      threadsProcessed++;
      const threadUpdatedAt = safeDate((t as any)?.updated_time) ?? new Date();

      const conv = await prisma.dMConversation.upsert({
        where: {
          brandId_socialAccountId_platform_participantExternalUserId: {
            brandId,
            socialAccountId: account.id,
            platform: 'instagram',
            participantExternalUserId: picked.participantExternalUserId,
          },
        } as any,
        create: {
          brandId,
          socialAccountId: account.id,
          platform: 'instagram',
          participantExternalUserId: picked.participantExternalUserId,
          participantUsername: picked.participantUsername,
          state: 'active',
          lastMessageAt: threadUpdatedAt,
        },
        update: {
          participantUsername: picked.participantUsername,
          lastMessageAt: threadUpdatedAt,
        },
      });
      conversationsUpserted++;

      let messagesRes: Awaited<
        ReturnType<typeof instagramService.getDmThreadMessagesForSocialAccount>
      >;
      try {
        messagesRes = await instagramService.getDmThreadMessagesForSocialAccount(
          account.id,
          threadId,
          {
            limit: Math.max(1, Math.min(perThreadLimit, 50)),
          }
        );
      } catch (error) {
        logger.warn('Failed to fetch Instagram DM thread messages', {
          brandId,
          socialAccountId: account.id,
          threadId,
          ...formatError(error),
        });
        continue;
      }
      if (!messagesRes.supported) {
        logger.info('Instagram DM thread messages not supported', {
          brandId,
          socialAccountId: account.id,
          threadId,
        });
        continue;
      }

      let latestMessageAt: Date | null = null;
      for (const m of messagesRes.messages) {
        const externalMessageId = String((m as any)?.id || '').trim();
        const messageTextRaw = (m as any)?.message;
        const messageText = typeof messageTextRaw === 'string' ? messageTextRaw : null;
        if (!externalMessageId || !messageText) {
          continue;
        }

        const createdAt = safeDate((m as any)?.created_time) ?? new Date();
        if (!latestMessageAt || createdAt > latestMessageAt) {
          latestMessageAt = createdAt;
        }

        const fromId = String((m as any)?.from?.id || '').trim();
        const direction = fromId && selfIds.has(fromId) ? 'outbound' : 'inbound';

        try {
          await prisma.dMMessage.create({
            data: {
              conversationId: conv.id,
              platform: 'instagram',
              direction,
              messageText,
              externalMessageId,
              status: 'delivered',
              deliveredAt: createdAt,
              createdAt,
            },
          });
          messagesInserted++;
        } catch {
          // Unique constraint (conversationId + externalMessageId) prevents duplicates.
        }
      }

      if (latestMessageAt) {
        try {
          await prisma.dMConversation.update({
            where: { id: conv.id },
            data: { lastMessageAt: latestMessageAt },
          });
        } catch {
          // best effort
        }
      }
    }
  }

  return { accountsProcessed, threadsProcessed, conversationsUpserted, messagesInserted };
}
