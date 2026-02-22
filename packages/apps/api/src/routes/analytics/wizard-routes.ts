import type { FastifyPluginAsync, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { getDatabaseClient } from '../../config/database.js';
import { validateBody } from '../../middleware/validation.js';
import { ensureAuth } from './shared.js';

const prisma = getDatabaseClient();

export const wizardAnalyticsRoutes: FastifyPluginAsync = async (fastify) => {
  const WizardEventSchema = z.object({
    eventName: z.enum(['wizard.step', 'wizard.reset', 'wizard.launch']),
    step: z.number().int().min(1).max(7).optional(), // Updated to 7 for new wizard steps
    brandId: z.string().min(1).optional(),
  });

  fastify.post(
    '/wizard-event',
    {
      preHandler: [
        fastify.authenticate,
        validateBody(WizardEventSchema) as unknown as preHandlerHookHandler,
      ],
    },
    async (request, reply) => {
      try {
        if (!ensureAuth(request, reply)) {
          return;
        }
        const userId = request.user.id;
        const email = request.user.email;
        const { eventName, step, brandId } = request.body as z.infer<typeof WizardEventSchema>;

        // Persist as audit log for lightweight analytics
        await prisma.auditLog.create({
          data: {
            userId,
            email,
            eventType: 'wizard.event',
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'] || null,
            metadata: {
              eventName,
              step,
              brandId,
              path: request.url,
              timestamp: new Date().toISOString(),
            },
            success: true,
          },
        });

        return reply.send({ success: true });
      } catch (error) {
        request.log.error({ error }, 'Failed to log wizard event');
        return reply.code(500).send({ error: 'Failed to log wizard event' });
      }
    }
  );
};
