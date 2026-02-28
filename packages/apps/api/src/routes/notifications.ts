import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import {
  listNotificationsQuerySchema,
  patchNotificationSchema,
  updatePreferencesSchema,
} from '../schemas/notifications.js';
import { notificationsService } from '../services/notifications.js';

function registerListNotificationsRoute(fastify: FastifyInstance): void {
  fastify.get('/', { preHandler: fastify.authenticate }, async (request, reply) => {
    const userId = request.user!.id;
    const parsed = listNotificationsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
    }

    const query = parsed.data;
    const result = await notificationsService.list({
      userId,
      brandId: query.brandId,
      cursor: query.cursor,
      limit: query.limit,
      filter: query.filter,
      category: query.category,
      type: query.type,
      since: query.since ? new Date(query.since) : undefined,
    });

    return reply.send(result);
  });
}

function registerPatchNotificationRoute(fastify: FastifyInstance): void {
  fastify.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const parsed = patchNotificationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
      }

      const result = await notificationsService.mark(request.params.id, userId, parsed.data);
      return reply.send(result);
    }
  );
}

function registerMarkAllReadRoute(fastify: FastifyInstance): void {
  fastify.post<{ Body: { before?: string } }>(
    '/mark-all-read',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const before = request.body?.before ? new Date(request.body.before) : undefined;
      const result = await notificationsService.markAllRead(userId, before);
      return reply.send(result);
    }
  );
}

function registerGetPreferencesRoute(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: { brandId?: string } }>(
    '/preferences',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const result = await notificationsService.getPreferences(userId, request.query?.brandId);
      return reply.send(result);
    }
  );
}

function registerUpdatePreferencesRoute(fastify: FastifyInstance): void {
  fastify.patch('/preferences', { preHandler: fastify.authenticate }, async (request, reply) => {
    const userId = request.user!.id;
    const parsed = updatePreferencesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    }

    const result = await notificationsService.updatePreferences(userId, parsed.data.updates);
    return reply.send(result);
  });
}

function registerTestNotificationRoute(fastify: FastifyInstance): void {
  fastify.post<{ Body: { brandId?: string; title?: string; body?: string } }>(
    '/test',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const notification = await notificationsService.emitEvent({
        userId,
        brandId: request.body?.brandId,
        type: 'system.test_notification',
        category: 'system',
        severity: 'info',
        title: request.body?.title || 'Test notification from Postolio',
        body: request.body?.body || 'This is a test to confirm notifications are working.',
        linkUrl: 'https://postolio.example/notifications',
      });

      return reply.send({ success: true, id: notification?.id || null });
    }
  );
}

const notificationsRoutes: FastifyPluginAsync = async (fastify) => {
  registerListNotificationsRoute(fastify);
  registerPatchNotificationRoute(fastify);
  registerMarkAllReadRoute(fastify);
  registerGetPreferencesRoute(fastify);
  registerUpdatePreferencesRoute(fastify);
  registerTestNotificationRoute(fastify);
};

export default notificationsRoutes;
