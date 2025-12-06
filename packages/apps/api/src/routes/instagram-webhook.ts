/**
 * Instagram Webhook Routes
 * Handles webhook events from Instagram (comments, DMs) for DM automation
 */

import { FastifyPluginAsync } from 'fastify';
import { dmAutomation } from '../services/dm-automation.js';
import { prisma } from '../config/database.js';
import { logger as baseLogger } from '@postolio/logger';
import * as crypto from 'crypto';

const logger = baseLogger.child({ module: 'instagram-webhook' });

// Webhook verification token (set in Meta App Dashboard)
const VERIFY_TOKEN = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || 'postolio_webhook_secret';
const APP_SECRET = process.env.FACEBOOK_APP_SECRET!;

/**
 * Verify webhook signature to ensure request is from Facebook/Instagram
 */
function verifyWebhookSignature(payload: string, signature: string, appSecret: string): boolean {
  if (!signature) return false;

  try {
    const expectedSignature =
      'sha256=' + crypto.createHmac('sha256', appSecret).update(payload).digest('hex');

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
async function findBrandByInstagramAccount(accountId: string): Promise<{ id: string } | null> {
  try {
    const socialAccount = await prisma.socialAccount.findFirst({
      where: {
        platform: 'instagram',
        OR: [{ externalAccountId: accountId }, { externalPageId: accountId }],
      },
      select: {
        brandId: true,
      },
    });

    if (!socialAccount?.brandId) {
      logger.debug('No brand found for Instagram account', { accountId });
      return null;
    }

    return { id: socialAccount.brandId };
  } catch (error) {
    logger.error('Error finding brand by Instagram account', {
      accountId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
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

    // Find brand by media owner
    const brand = await findBrandByInstagramAccount(media.id);
    if (!brand) {
      logger.debug('No brand found for comment event', { mediaId: media.id });
      return;
    }

    logger.info('Processing comment event', {
      brandId: brand.id,
      commentId,
      username: from.username,
    });

    // Trigger DM automation
    await dmAutomation.processEvent({
      brandId: brand.id,
      triggerType: 'comment_keyword',
      triggerSource: 'comment',
      triggerText: text,
      triggeredBy: from.username,
      instagramUserId: from.id,
      externalCommentId: commentId,
      postUrl: `https://www.instagram.com/p/${media.id}`,
    });

    logger.info('Comment event processed successfully', {
      brandId: brand.id,
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

    // Find brand by recipient (the Instagram account receiving the message)
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

    // Trigger DM automation
    await dmAutomation.processEvent({
      brandId: brand.id,
      triggerType: 'dm_keyword',
      triggerSource: 'dm',
      triggerText: message.text,
      triggeredBy: sender.username || sender.id,
      instagramUserId: sender.id,
    });

    logger.info('Message event processed successfully', {
      brandId: brand.id,
      messageId: message.mid,
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
      const rawBody = JSON.stringify(request.body);

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

      const body = request.body as any;

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
