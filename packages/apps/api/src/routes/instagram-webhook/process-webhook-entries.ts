import { Prisma } from '@postolio/database';
import { logger as baseLogger } from '@postolio/logger';

import { prisma } from '../../config/database.js';
import { dmAutomation } from '../../services/dm-automation.js';
import { getStatusBroadcaster } from '../../services/broadcast-registry.js';

const logger = baseLogger.child({ module: 'instagram-webhook' });

function isUniqueConstraintError(
  error: unknown,
  code: string
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

async function findBrandByInstagramAccount(
  accountId: string
): Promise<{ id: string; socialAccountId: string } | null> {
  try {
    const socialAccount = await prisma.socialAccount.findFirst({
      where: {
        platform: 'instagram',
        OR: [{ externalAccountId: accountId }, { externalPageId: accountId }],
      },
      select: { brandId: true, id: true },
    });
    if (!socialAccount?.brandId) {
      logger.debug('No brand found for Instagram account', { accountId });
      return null;
    }
    return { id: socialAccount.brandId, socialAccountId: socialAccount.id };
  } catch (error) {
    logger.error('Error finding brand by Instagram account', {
      accountId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

async function findPublicationByInstagramMediaId(mediaId: string): Promise<{
  publicationId: string;
  brandId: string;
  socialAccountId: string;
  permalink: string | null;
} | null> {
  const pub = await prisma.contentPublication.findFirst({
    where: { platform: 'instagram', externalPostId: String(mediaId || '') },
    select: {
      id: true,
      socialAccountId: true,
      permalink: true,
      content: { select: { brandId: true } },
    },
  });
  if (!pub?.id || !pub.content?.brandId) {
    return null;
  }
  return {
    publicationId: pub.id,
    brandId: pub.content.brandId,
    socialAccountId: pub.socialAccountId,
    permalink: pub.permalink || null,
  };
}

type CommentWebhookValue = {
  id: string;
  from: { id: string; username: string };
  text: string;
  media: { id: string; media_product_type?: string };
  parent_id?: string;
  timestamp?: string;
};

function parseCommentWebhookValue(value: unknown): CommentWebhookValue {
  return value as CommentWebhookValue;
}

async function persistCommentForInbox(
  mapped: { publicationId: string },
  comment: CommentWebhookValue
): Promise<void> {
  try {
    const fetchedAt = new Date();
    const createdAt = comment.timestamp ? new Date(comment.timestamp) : undefined;
    await prisma.publicationComment.upsert({
      where: {
        publicationId_externalCommentId: {
          publicationId: mapped.publicationId,
          externalCommentId: comment.id,
        },
      } as any,
      update: {
        text: comment.text || null,
        authorUsername: comment.from.username || null,
        authorExternalUserId: comment.from.id || null,
        fetchedAt,
      },
      create: {
        publicationId: mapped.publicationId,
        platform: 'instagram',
        externalCommentId: comment.id,
        text: comment.text || null,
        authorUsername: comment.from.username || null,
        authorExternalUserId: comment.from.id || null,
        status: 'open',
        createdAt,
        fetchedAt,
      },
    });
  } catch (error) {
    logger.warn('Failed to persist comment for inbox', {
      error: error instanceof Error ? error.message : 'Unknown error',
      commentId: comment.id,
      mediaId: comment.media.id,
    });
  }
}

async function triggerCommentAutomation(
  mapped: { brandId: string; socialAccountId: string; permalink: string | null },
  comment: CommentWebhookValue
): Promise<void> {
  await dmAutomation.processEvent({
    brandId: mapped.brandId,
    socialAccountId: mapped.socialAccountId,
    platform: 'instagram',
    triggerType: 'comment_keyword',
    triggerSource: 'comment',
    triggerText: comment.text,
    triggeredBy: comment.from.username,
    participantExternalUserId: comment.from.id,
    externalCommentId: comment.id,
    postUrl: mapped.permalink || undefined,
  });
}

async function handleCommentEvent(value: any): Promise<void> {
  try {
    const comment = parseCommentWebhookValue(value);
    const { id: commentId, from, media, parent_id: parentId } = comment;
    if (parentId) {
      logger.debug('Skipping comment reply', { commentId, parentId });
      return;
    }

    const mapped = await findPublicationByInstagramMediaId(media.id);
    if (!mapped) {
      logger.debug('No publication found for comment event', { mediaId: media.id });
      return;
    }

    logger.info('Processing comment event', {
      brandId: mapped.brandId,
      commentId,
      username: from.username,
    });
    await persistCommentForInbox(mapped, comment);
    await triggerCommentAutomation(mapped, comment);
    logger.info('Comment event processed successfully', {
      brandId: mapped.brandId,
      commentId,
    });
  } catch (error) {
    logger.error('Error handling comment event', {
      error: error instanceof Error ? error.message : 'Unknown error',
      value,
    });
    throw error;
  }
}

type MessageWebhookValue = {
  sender: { id: string; username?: string };
  recipient: { id: string };
  message: { text?: string; mid: string };
};

type ConversationPersistResult = { conversationId: string | null; messageRowId: string | null };

function parseMessageWebhookValue(value: unknown): MessageWebhookValue {
  return value as MessageWebhookValue;
}

async function upsertDMConversation(
  brand: { id: string; socialAccountId: string },
  sender: { id: string; username?: string },
  now: Date
) {
  return prisma.dMConversation.upsert({
    where: {
      brandId_socialAccountId_platform_participantExternalUserId: {
        brandId: brand.id,
        socialAccountId: brand.socialAccountId,
        platform: 'instagram',
        participantExternalUserId: sender.id,
      },
    } as any,
    create: {
      brandId: brand.id,
      socialAccountId: brand.socialAccountId,
      platform: 'instagram',
      participantExternalUserId: sender.id,
      participantUsername: sender.username || sender.id,
      state: 'active',
      lastMessageAt: now,
    },
    update: {
      participantUsername: sender.username || sender.id,
      lastMessageAt: now,
    },
  });
}

async function createInboundMessageIfMissing(
  brand: { id: string; socialAccountId: string },
  conversationId: string,
  sender: { id: string; username?: string },
  message: { text?: string; mid: string },
  now: Date
): Promise<string | null> {
  const existing = message.mid
    ? await prisma.dMMessage.findFirst({
        where: { conversationId, externalMessageId: message.mid },
        select: { id: true },
      })
    : null;
  if (existing) {
    return null;
  }

  try {
    const dmMessage = await prisma.dMMessage.create({
      data: {
        conversationId,
        platform: 'instagram',
        direction: 'inbound',
        messageText: message.text || '',
        externalMessageId: message.mid,
        status: 'delivered',
        deliveredAt: now,
      },
    });
    const broadcaster = getStatusBroadcaster();
    if (broadcaster) {
      await broadcaster.broadcastDMMessage({
        conversationId,
        messageId: dmMessage.id,
        brandId: brand.id,
        socialAccountId: brand.socialAccountId,
        platform: 'instagram',
        direction: 'inbound',
        messageText: message.text || '',
        participantUsername: sender.username || sender.id,
      });
    }
    return dmMessage.id;
  } catch (error) {
    if (isUniqueConstraintError(error, 'P2002')) {
      logger.debug('Skipping duplicate inbound DM message insert', {
        brandId: brand.id,
        socialAccountId: brand.socialAccountId,
        conversationId,
        messageId: message.mid,
      });
      return null;
    }
    throw error;
  }
}

async function persistInboundDMMessage(
  brand: { id: string; socialAccountId: string },
  sender: { id: string; username?: string },
  message: { text?: string; mid: string }
): Promise<ConversationPersistResult> {
  try {
    const now = new Date();
    const conversation = await upsertDMConversation(brand, sender, now);
    const messageRowId = await createInboundMessageIfMissing(
      brand,
      conversation.id,
      sender,
      message,
      now
    );
    return { conversationId: conversation.id, messageRowId };
  } catch (error) {
    logger.error('Failed to persist inbound DM message', {
      brandId: brand.id,
      socialAccountId: brand.socialAccountId,
      messageId: message.mid,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return { conversationId: null, messageRowId: null };
  }
}

async function triggerDMMessageAutomation(
  brand: { id: string; socialAccountId: string },
  sender: { id: string; username?: string },
  message: { text?: string; mid: string }
): Promise<void> {
  await dmAutomation.processEvent({
    brandId: brand.id,
    socialAccountId: brand.socialAccountId,
    platform: 'instagram',
    triggerType: 'dm_keyword',
    triggerSource: 'dm',
    triggerText: message.text || '',
    triggeredBy: sender.username || sender.id,
    participantExternalUserId: sender.id,
  });
}

async function handleMessageEvent(value: any): Promise<void> {
  try {
    const { sender, recipient, message } = parseMessageWebhookValue(value);
    if (!message.text) {
      logger.debug('Skipping message without text', { messageId: message.mid });
      return;
    }

    const brand = await findBrandByInstagramAccount(recipient.id);
    if (!brand) {
      logger.debug('No brand found for message event', { recipientId: recipient.id });
      return;
    }

    logger.info('Processing message event', {
      brandId: brand.id,
      senderId: sender.id,
      messageId: message.mid,
    });
    const { conversationId, messageRowId } = await persistInboundDMMessage(brand, sender, message);
    await triggerDMMessageAutomation(brand, sender, message);
    logger.info('Message event processed successfully', {
      brandId: brand.id,
      messageId: message.mid,
      conversationId,
      messageRowId,
    });
  } catch (error) {
    logger.error('Error handling message event', {
      error: error instanceof Error ? error.message : 'Unknown error',
      value,
    });
    throw error;
  }
}

export async function processWebhookEntries(body: any): Promise<void> {
  logger.debug('Processing webhook payload', {
    entryCount: body.entry?.length || 0,
  });

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const field = change.field;
      logger.debug('Processing webhook change', { field, hasValue: !!change.value });
      if (field === 'comments') {
        await handleCommentEvent(change.value);
      } else if (field === 'messages') {
        await handleMessageEvent(change.value);
      } else {
        logger.debug('Ignoring webhook field', { field });
      }
    }
  }
}
