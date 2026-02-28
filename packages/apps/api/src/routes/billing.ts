import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import {
  createCheckoutSessionSchema,
  createCreditCheckoutSchema,
  createPortalSessionSchema,
  listInvoicesQuerySchema,
} from '../schemas/billing.js';
import { billingService } from '../services/billing.js';

function errorStatus(error: unknown) {
  const statusCode = (error as { statusCode?: unknown })?.statusCode;
  return typeof statusCode === 'number' ? statusCode : 500;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Billing request failed.';
}

function registerSubscriptionCheckoutRoute(fastify: FastifyInstance): void {
  fastify.post(
    '/checkout/subscription',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const parsed = createCheckoutSessionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'Invalid request body.', details: parsed.error.flatten() });
      }

      try {
        const session = await billingService.createSubscriptionCheckoutSession({
          userId: request.user!.id,
          priceId: parsed.data.priceId,
          successUrl: parsed.data.successUrl,
          cancelUrl: parsed.data.cancelUrl,
        });
        return reply.send(session);
      } catch (error) {
        request.log.error({ err: error }, 'Failed to create subscription checkout session');
        return reply.code(errorStatus(error)).send({ error: errorMessage(error) });
      }
    }
  );
}

function registerCreditCheckoutRoute(fastify: FastifyInstance): void {
  fastify.post(
    '/checkout/credits',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const parsed = createCreditCheckoutSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'Invalid request body.', details: parsed.error.flatten() });
      }

      try {
        const session = await billingService.createCreditCheckoutSession({
          userId: request.user!.id,
          brandId: parsed.data.brandId,
          creditPack: parsed.data.creditPack,
          successUrl: parsed.data.successUrl,
          cancelUrl: parsed.data.cancelUrl,
        });
        return reply.send(session);
      } catch (error) {
        request.log.error({ err: error }, 'Failed to create credit checkout session');
        return reply.code(errorStatus(error)).send({ error: errorMessage(error) });
      }
    }
  );
}

function registerSubscriptionRoutes(fastify: FastifyInstance): void {
  fastify.get('/subscription', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const result = await billingService.getSubscription(request.user!.id);
      return reply.send(result);
    } catch (error) {
      request.log.error({ err: error }, 'Failed to load billing subscription');
      return reply.code(errorStatus(error)).send({ error: errorMessage(error) });
    }
  });

  fastify.post(
    '/subscription/cancel',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const result = await billingService.cancelSubscription(request.user!.id);
        return reply.send(result);
      } catch (error) {
        request.log.error({ err: error }, 'Failed to cancel subscription');
        return reply.code(errorStatus(error)).send({ error: errorMessage(error) });
      }
    }
  );

  fastify.post(
    '/subscription/reactivate',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const result = await billingService.reactivateSubscription(request.user!.id);
        return reply.send(result);
      } catch (error) {
        request.log.error({ err: error }, 'Failed to reactivate subscription');
        return reply.code(errorStatus(error)).send({ error: errorMessage(error) });
      }
    }
  );
}

function registerInvoiceAndPortalRoutes(fastify: FastifyInstance): void {
  fastify.get('/invoices', { preHandler: fastify.authenticate }, async (request, reply) => {
    const parsed = listInvoicesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid query.', details: parsed.error.flatten() });
    }

    try {
      const result = await billingService.listInvoices(
        request.user!.id,
        parsed.data.limit || 10,
        parsed.data.startingAfter
      );
      return reply.send(result);
    } catch (error) {
      request.log.error({ err: error }, 'Failed to list invoices');
      return reply.code(errorStatus(error)).send({ error: errorMessage(error) });
    }
  });

  fastify.post('/portal', { preHandler: fastify.authenticate }, async (request, reply) => {
    const parsed = createPortalSessionSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid request body.', details: parsed.error.flatten() });
    }

    try {
      const result = await billingService.createPortalSession(
        request.user!.id,
        parsed.data.returnUrl
      );
      return reply.send(result);
    } catch (error) {
      request.log.error({ err: error }, 'Failed to create customer portal session');
      return reply.code(errorStatus(error)).send({ error: errorMessage(error) });
    }
  });
}

const billingRoutes: FastifyPluginAsync = async (fastify) => {
  registerSubscriptionCheckoutRoute(fastify);
  registerCreditCheckoutRoute(fastify);
  registerSubscriptionRoutes(fastify);
  registerInvoiceAndPortalRoutes(fastify);
};

export default billingRoutes;
