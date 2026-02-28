/**
 * Instagram Webhook Routes
 * Handles webhook events from Instagram (comments, DMs) for DM automation
 */

import type { FastifyPluginAsync } from 'fastify';
import { logger as baseLogger } from '@postolio/logger';
import * as crypto from 'crypto';

import { processWebhookEntries } from './instagram-webhook/process-webhook-entries.js';

const logger = baseLogger.child({ module: 'instagram-webhook' });

// Webhook verification token (set in Meta App Dashboard)
const VERIFY_TOKEN = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || 'postolio_webhook_secret';
const APP_SECRET = process.env.FACEBOOK_APP_SECRET!;

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

function registerWebhookVerificationRoute(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.get('/webhooks/instagram', async (request, reply) => {
    const query = request.query as any;
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    logger.info('Webhook verification request received', { mode, token: '***' });
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      logger.info('Webhook verified successfully');
      return reply.send(challenge);
    }

    logger.warn('Webhook verification failed', { mode, tokenMatch: token === VERIFY_TOKEN });
    return reply.code(403).send('Forbidden');
  });
}

function parseWebhookBody(rawBody: string, fallbackBody: unknown): any | null {
  try {
    return rawBody ? JSON.parse(rawBody) : fallbackBody;
  } catch {
    return null;
  }
}

function registerWebhookEventRoute(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.post('/webhooks/instagram', async (request, reply) => {
    try {
      const signature = request.headers['x-hub-signature-256'] as string;
      const rawBodyBuffer = request.body as Buffer;
      const rawBody = Buffer.isBuffer(rawBodyBuffer) ? rawBodyBuffer.toString('utf8') : '';

      if (!APP_SECRET) {
        logger.error('FACEBOOK_APP_SECRET not configured');
        return reply.code(500).send({ error: 'Server configuration error' });
      }

      if (!verifyWebhookSignature(rawBody, signature, APP_SECRET)) {
        logger.warn('Invalid webhook signature', { signaturePresent: !!signature });
        return reply.code(401).send({ error: 'Invalid signature' });
      }

      const body = parseWebhookBody(rawBody, request.body);
      if (!body) {
        logger.warn('Invalid JSON webhook payload');
        return reply.code(400).send({ error: 'Invalid JSON payload' });
      }

      // Facebook expects a fast 200 response.
      reply.send({ status: 'ok' });

      setImmediate(async () => {
        try {
          await processWebhookEntries(body);
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
}

const instagramWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  // Webhook signature verification requires exact raw body bytes.
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    async (_request, body, done) => {
      done(null, body);
    }
  );

  registerWebhookVerificationRoute(fastify);
  registerWebhookEventRoute(fastify);
};

export default instagramWebhookRoutes;
