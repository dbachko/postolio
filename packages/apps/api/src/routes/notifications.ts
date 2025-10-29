import type { FastifyPluginAsync } from 'fastify';
import {
  listNotificationsQuerySchema,
  patchNotificationSchema,
  updatePreferencesSchema,
} from '../schemas/notifications.js';
import { notificationsService } from '../services/notifications.js';

const notificationsRoutes: FastifyPluginAsync = async (fastify) => {
  // List notifications
  fastify.get('/', { preHandler: fastify.authenticate }, async (request, reply) => {
    const userId = request.user!.id;
    const parsed = listNotificationsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
    }
    const q = parsed.data;
    const result = await notificationsService.list({
      userId,
      brandId: q.brandId,
      cursor: q.cursor,
      limit: q.limit,
      filter: q.filter,
      category: q.category,
      type: q.type,
      since: q.since ? new Date(q.since) : undefined,
    });
    return reply.send(result);
  });

  // Patch notification (read/unread/archived)
  fastify.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const id = request.params.id;
      const parsed = patchNotificationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
      }
      const result = await notificationsService.mark(id, userId, parsed.data);
      return reply.send(result);
    }
  );

  // Mark all as read
  fastify.post<{ Body: { before?: string } }>(
    '/mark-all-read',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const beforeParam = request.body?.before;
      const before = beforeParam ? new Date(beforeParam) : undefined;
      const result = await notificationsService.markAllRead(userId, before);
      return reply.send(result);
    }
  );

  // Get preferences
  fastify.get<{ Querystring: { brandId?: string } }>(
    '/preferences',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const brandId = request.query?.brandId;
      const result = await notificationsService.getPreferences(userId, brandId);
      return reply.send(result);
    }
  );

  // Update preferences
  fastify.patch('/preferences', { preHandler: fastify.authenticate }, async (request, reply) => {
    const userId = request.user!.id;
    const parsed = updatePreferencesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const result = await notificationsService.updatePreferences(userId, parsed.data.updates);
    return reply.send(result);
  });

  // Send test notification (in-app + email if enabled)
  fastify.post<{ Body: { brandId?: string; title?: string; body?: string } }>(
    '/test',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const brandId = request.body?.brandId;
      const title = request.body?.title || 'Test notification from Postolio';
      const body = request.body?.body || 'This is a test to confirm notifications are working.';

      const n = await notificationsService.emitEvent({
        userId,
        brandId,
        type: 'system.test_notification',
        category: 'system',
        severity: 'info',
        title,
        body,
        linkUrl: 'https://postolio.example/notifications',
      });

      return reply.send({ success: true, id: n?.id || null });
    }
  );
};

export default notificationsRoutes;
