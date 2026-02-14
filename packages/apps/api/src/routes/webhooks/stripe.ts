import type { FastifyPluginAsync } from 'fastify';
import { billingService } from '../../services/billing.js';

const stripeWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  // Stripe signature verification requires exact raw bytes.
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    async (_request, body, done) => {
      done(null, body);
    }
  );

  fastify.post('/webhooks/stripe', async (request, reply) => {
    const signature = request.headers['stripe-signature'];
    if (!signature || typeof signature !== 'string') {
      return reply.code(400).send({ error: 'Missing stripe-signature header.' });
    }

    const rawBodyBuffer = request.body as Buffer;
    const rawBody = Buffer.isBuffer(rawBodyBuffer) ? rawBodyBuffer.toString('utf8') : '';
    if (!rawBody) {
      return reply.code(400).send({ error: 'Missing webhook payload.' });
    }

    try {
      const event = billingService.constructWebhookEvent(rawBody, signature);
      await billingService.processWebhookEvent(event);
      return reply.send({ received: true });
    } catch (error) {
      request.log.error({ err: error }, 'Failed to process Stripe webhook');
      const message = error instanceof Error ? error.message : 'Webhook processing failed.';
      if (message.toLowerCase().includes('signature')) {
        return reply.code(400).send({ error: 'Invalid webhook signature.' });
      }
      const statusCode =
        typeof (error as { statusCode?: unknown })?.statusCode === 'number'
          ? ((error as { statusCode: number }).statusCode as number)
          : 500;
      return reply.code(statusCode).send({ error: message });
    }
  });
};

export default stripeWebhookRoutes;
