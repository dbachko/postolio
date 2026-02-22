/**
 * Instagram Webhook Routes
 * Handles webhook events from Instagram (comments, DMs) for DM automation
 */

import type { FastifyPluginAsync } from 'fastify';
import { dmAutomation } from '../services/dm-automation.js';
import { prisma } from '../config/database.js';
import { logger as baseLogger } from '@postolio/logger';
import * as crypto from 'crypto';
import { getStatusBroadcaster } from '../services/broadcast-registry.js';
import { Prisma } from '@postolio/database';

const logger = baseLogger.child({ module: 'instagram-webhook' });

// Webhook verification token (set in Meta App Dashboard)
const VERIFY_TOKEN = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || 'postolio_webhook_secret';
const APP_SECRET = process.env.FACEBOOK_APP_SECRET!;

function isUniqueConstraintError(
  error: unknown,
  code: string
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

/**
 * Verify webhook signature to ensure request is from Facebook/Instagram
 */
function verifyWebhookSignature(payload: string, signature: string, appSecret: string): boolean {
  if (!signature) {
    return false;
  }

  try {
    const expectedSignature = `sha256=${crypto.createHmac('sha256', appSecret).update(payload).digest('hex')}`;

    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch (error) {
    logger.error('Error verifying webhook signature', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

/**
 * Find brand by Instagram account ID or page ID
 */
async function findBrandByInstagramAccount(
  accountId: string
): Promise<{ id: string; socialAccountId: string } | null> {
  try {
    const socialAccount = await prisma.socialAccount.findFirst({
      where: {
        platform: 'instagram',
        OR: [{ externalAccountId: accountId }, { externalPageId: accountId }],
      },
      select: {
        brandId: true,
        id: true,
      },
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

/**
 * Find a publication by Instagram media ID (externalPostId) so we can map webhook comment events
 * to the correct brand + social account.
 */
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

/**
 * Handle comment webhook event
 */
async function handleCommentEvent(value: any): Promise<void> {
  try {
    const {
      id: commentId,
      from,
      text,
      media,
      parent_id: parentId,
    } = value as {
      id: string;
      from: { id: string; username: string };
      text: string;
      media: { id: string; media_product_type?: string };
      parent_id?: string;
    };

    // Skip if this is a reply to another comment (we only process top-level comments)
    if (parentId) {
      logger.debug('Skipping comment reply', { commentId, parentId });
      return;
    }

    // Resolve publication by media id (externalPostId) to avoid account ambiguity
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

    // Persist comment for inbox workflow (idempotent via unique constraint)
    try {
      const fetchedAt = new Date();
      const createdAt = (value as any)?.timestamp ? new Date((value as any).timestamp) : undefined;
      await prisma.publicationComment.upsert({
        where: {
          publicationId_externalCommentId: {
            publicationId: mapped.publicationId,
            externalCommentId: commentId,
          },
        } as any,
        update: {
          text: text || null,
          authorUsername: from.username || null,
          authorExternalUserId: from.id || null,
          fetchedAt,
        },
        create: {
          publicationId: mapped.publicationId,
          platform: 'instagram',
          externalCommentId: commentId,
          text: text || null,
          authorUsername: from.username || null,
          authorExternalUserId: from.id || null,
          status: 'open',
          createdAt,
          fetchedAt,
        },
      });
    } catch (e) {
      logger.warn('Failed to persist comment for inbox', {
        error: e instanceof Error ? e.message : 'Unknown error',
        commentId,
        mediaId: media.id,
      });
    }

    // Trigger DM automation
    await dmAutomation.processEvent({
      brandId: mapped.brandId,
      socialAccountId: mapped.socialAccountId,
      platform: 'instagram',
      triggerType: 'comment_keyword',
      triggerSource: 'comment',
      triggerText: text,
      triggeredBy: from.username,
      participantExternalUserId: from.id,
      externalCommentId: commentId,
      postUrl: mapped.permalink || undefined,
    });

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

/**
 * Handle message (DM) webhook event
 */
async function handleMessageEvent(value: any): Promise<void> {
  try {
    const { sender, recipient, message } = value as {
      sender: { id: string; username?: string };
      recipient: { id: string };
      message: { text?: string; mid: string };
    };

    // Skip if no text in message
    if (!message.text) {
      logger.debug('Skipping message without text', { messageId: message.mid });
      return;
    }

    // Find brand + social account by recipient (the Instagram account receiving the message)
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

    // Persist inbound DM message for inbox
    let conversationId: string | null = null;
    let messageRowId: string | null = null;
    try {
      const now = new Date();
      const conv = await prisma.dMConversation.upsert({
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
      conversationId = conv.id;

      // Idempotency: skip if we've already stored this external message id for the conversation
      const existing = message.mid
        ? await prisma.dMMessage.findFirst({
            where: { conversationId: conv.id, externalMessageId: message.mid },
            select: { id: true },
          })
        : null;

      if (!existing) {
        try {
          const dmMessage = await prisma.dMMessage.create({
            data: {
              conversationId: conv.id,
              platform: 'instagram',
              direction: 'inbound',
              messageText: message.text,
              externalMessageId: message.mid,
              status: 'delivered',
              deliveredAt: now,
            },
          });
          messageRowId = dmMessage.id;

          const broadcaster = getStatusBroadcaster();
          if (broadcaster) {
            await broadcaster.broadcastDMMessage({
              conversationId: conv.id,
              messageId: dmMessage.id,
              brandId: brand.id,
              socialAccountId: brand.socialAccountId,
              platform: 'instagram',
              direction: 'inbound',
              messageText: message.text,
              participantUsername: sender.username || sender.id,
            });
          }
        } catch (error) {
          if (isUniqueConstraintError(error, 'P2002')) {
            logger.debug('Skipping duplicate inbound DM message insert', {
              brandId: brand.id,
              socialAccountId: brand.socialAccountId,
              conversationId: conv.id,
              messageId: message.mid,
            });
          } else {
            throw error;
          }
        }
      }
    } catch (e) {
      logger.error('Failed to persist inbound DM message', {
        brandId: brand.id,
        socialAccountId: brand.socialAccountId,
        messageId: message.mid,
        error: e instanceof Error ? e.message : 'Unknown error',
      });
    }

    // Trigger DM automation
    await dmAutomation.processEvent({
      brandId: brand.id,
      socialAccountId: brand.socialAccountId,
      platform: 'instagram',
      triggerType: 'dm_keyword',
      triggerSource: 'dm',
      triggerText: message.text,
      triggeredBy: sender.username || sender.id,
      participantExternalUserId: sender.id,
    });

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

const instagramWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  // IMPORTANT: Webhook signature verification requires the exact raw request body bytes.
  // Use an encapsulated content-type parser so only this plugin's routes receive Buffer bodies.
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    async (_request, body, done) => {
      done(null, body);
    }
  );

  /**
   * GET /webhooks/instagram
   * Webhook verification endpoint - Facebook/Instagram calls this to verify webhook
   */
  fastify.get('/webhooks/instagram', async (request, reply) => {
    const query = request.query as any;
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    logger.info('Webhook verification request received', { mode, token: '***' });

    // Check if verification request
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      logger.info('Webhook verified successfully');
      return reply.send(challenge);
    }

    logger.warn('Webhook verification failed', { mode, tokenMatch: token === VERIFY_TOKEN });
    return reply.code(403).send('Forbidden');
  });

  /**
   * POST /webhooks/instagram
   * Webhook event endpoint - receives comment and message events
   */
  fastify.post('/webhooks/instagram', async (request, reply) => {
    try {
      // Verify webhook signature for security
      const signature = request.headers['x-hub-signature-256'] as string;
      const rawBodyBuffer = request.body as Buffer;
      const rawBody = Buffer.isBuffer(rawBodyBuffer) ? rawBodyBuffer.toString('utf8') : '';

      if (!APP_SECRET) {
        logger.error('FACEBOOK_APP_SECRET not configured');
        return reply.code(500).send({ error: 'Server configuration error' });
      }

      const isValid = verifyWebhookSignature(rawBody, signature, APP_SECRET);
      if (!isValid) {
        logger.warn('Invalid webhook signature', {
          signaturePresent: !!signature,
        });
        return reply.code(401).send({ error: 'Invalid signature' });
      }

      let body: any;
      try {
        body = rawBody ? JSON.parse(rawBody) : request.body;
      } catch {
        logger.warn('Invalid JSON webhook payload');
        return reply.code(400).send({ error: 'Invalid JSON payload' });
      }

      // Acknowledge webhook immediately (Facebook expects 200 within 20 seconds)
      reply.send({ status: 'ok' });

      // Process events asynchronously in background
      setImmediate(async () => {
        try {
          logger.debug('Processing webhook payload', {
            entryCount: body.entry?.length || 0,
          });

          for (const entry of body.entry || []) {
            for (const change of entry.changes || []) {
              const field = change.field;

              logger.debug('Processing webhook change', {
                field,
                hasValue: !!change.value,
              });

              if (field === 'comments') {
                await handleCommentEvent(change.value);
              } else if (field === 'messages') {
                await handleMessageEvent(change.value);
              } else {
                logger.debug('Ignoring webhook field', { field });
              }
            }
          }
        } catch (error) {
          logger.error('Error processing webhook events', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
      });
    } catch (error) {
      logger.error('Error handling webhook request', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
};

export default instagramWebhookRoutes;
