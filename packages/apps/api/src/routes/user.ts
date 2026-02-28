import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { getDatabaseClient } from '../config/database.js';
import type { ThemePreference, WeekStartPreference } from '@postolio/database';
import { TimezoneService } from '../services/timezone.js';
import { assertBrandOwnership } from '../services/ownership.js';

const prisma = getDatabaseClient();

function isTimezoneUpdateBody(
  body: unknown
): body is { timezone: string; timezoneAutoDetected: boolean } {
  if (!body || typeof body !== 'object') {
    return false;
  }

  const obj = body as Record<string, unknown>;
  return typeof obj.timezone === 'string' && typeof obj.timezoneAutoDetected === 'boolean';
}

function isBrandTimezoneUpdateBody(body: unknown): body is { timezone: string | null } {
  if (!body || typeof body !== 'object') {
    return false;
  }

  const obj = body as Record<string, unknown>;
  return obj.timezone === null || typeof obj.timezone === 'string';
}

function isThemeUpdateBody(body: unknown): body is { theme: 'system' | 'light' | 'dark' } {
  if (!body || typeof body !== 'object') {
    return false;
  }
  const obj = body as Record<string, unknown>;
  const theme = obj.theme;
  return theme === 'system' || theme === 'light' || theme === 'dark';
}

function isWeekStartUpdateBody(body: unknown): body is { weekStart: 'monday' | 'sunday' } {
  if (!body || typeof body !== 'object') {
    return false;
  }
  const obj = body as Record<string, unknown>;
  return obj.weekStart === 'monday' || obj.weekStart === 'sunday';
}

function validateTimezoneUpdate(
  body: unknown
): { timezone: string; timezoneAutoDetected: boolean } | null {
  return isTimezoneUpdateBody(body) ? body : null;
}

function validateBrandTimezoneUpdate(body: unknown): { timezone: string | null } | null {
  return isBrandTimezoneUpdateBody(body) ? body : null;
}

function validateThemeUpdate(body: unknown): { theme: 'system' | 'light' | 'dark' } | null {
  return isThemeUpdateBody(body) ? body : null;
}

function validateWeekStartUpdate(body: unknown): { weekStart: 'monday' | 'sunday' } | null {
  return isWeekStartUpdateBody(body) ? body : null;
}

function registerSidebarWidthRoute(fastify: FastifyInstance) {
  fastify.patch(
    '/api/users/ui/sidebar-width',
    { preHandler: fastify.authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user!.id;
      try {
        const body = request.body as { type?: string; width?: number };
        const type = typeof body?.type === 'string' ? body.type : null;
        const width = Number(body?.width);

        if (!type || !Number.isFinite(width) || width <= 0) {
          return reply
            .status(400)
            .send({ error: 'Invalid body. Expected { type: string, width: number }' });
        }

        const existing = await prisma.user.findUnique({
          where: { id: userId },
          select: { uiPreferences: true },
        });
        const prefs = (existing?.uiPreferences as Record<string, unknown>) || {};
        const right = (prefs.rightSidebar as Record<string, unknown>) || {};
        right[type] = width;

        const newPrefs: Record<string, unknown> = { ...prefs, rightSidebar: right };
        await prisma.user.update({
          where: { id: userId },
          data: { uiPreferences: newPrefs as any },
        });

        return { success: true };
      } catch (err) {
        request.log.error({ err }, 'Failed to update right sidebar width');
        return reply.code(500).send({ error: 'Internal server error' });
      }
    }
  );
}

function registerUserTimezoneRoute(fastify: FastifyInstance) {
  fastify.patch(
    '/api/users/timezone',
    { preHandler: fastify.authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user!.id;

      try {
        const validatedData = validateTimezoneUpdate(request.body);
        if (!validatedData) {
          return reply.status(400).send({
            error:
              'Invalid request body. Expected { timezone: string, timezoneAutoDetected: boolean }',
          });
        }

        const { timezone, timezoneAutoDetected } = validatedData;
        if (!timezoneAutoDetected && !TimezoneService.isValidTimezone(timezone)) {
          return reply.status(400).send({ error: 'Invalid timezone' });
        }

        const updatedUser = await prisma.user.update({
          where: { id: userId },
          data: {
            timezone,
            timezoneAutoDetected,
          },
          select: {
            id: true,
            timezone: true,
            timezoneAutoDetected: true,
          },
        });

        return { success: true, user: updatedUser };
      } catch (err: unknown) {
        request.log.error({ err }, 'Failed to update user timezone');
        return reply.code(500).send({ error: 'Internal server error' });
      }
    }
  );
}

function registerThemeRoute(fastify: FastifyInstance) {
  fastify.patch(
    '/api/users/theme',
    { preHandler: fastify.authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user!.id;

      try {
        const validated = validateThemeUpdate(request.body);
        if (!validated) {
          return reply.status(400).send({
            error: 'Invalid request body. Expected { theme: "system"|"light"|"dark" }',
          });
        }

        const updatedUser = await prisma.user.update({
          where: { id: userId },
          data: {
            themePreference: validated.theme as unknown as ThemePreference,
          },
          select: {
            id: true,
            themePreference: true,
          },
        });

        return {
          success: true,
          user: {
            id: updatedUser.id,
            theme: updatedUser.themePreference,
          },
        };
      } catch (err: unknown) {
        request.log.error({ err }, 'Failed to update user theme');
        return reply.code(500).send({ error: 'Internal server error' });
      }
    }
  );
}

function registerWeekStartRoute(fastify: FastifyInstance) {
  fastify.patch(
    '/api/users/week-start',
    { preHandler: fastify.authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user!.id;

      try {
        const validated = validateWeekStartUpdate(request.body);
        if (!validated) {
          return reply.status(400).send({
            error: 'Invalid request body. Expected { weekStart: "monday"|"sunday" }',
          });
        }

        const updatedUser = await prisma.user.update({
          where: { id: userId },
          data: {
            weekStartPreference: validated.weekStart as WeekStartPreference,
          },
          select: {
            id: true,
            weekStartPreference: true,
          },
        });

        return {
          success: true,
          user: {
            id: updatedUser.id,
            weekStart: updatedUser.weekStartPreference,
          },
        };
      } catch (err: unknown) {
        request.log.error({ err }, 'Failed to update user week start');
        return reply.code(500).send({ error: 'Internal server error' });
      }
    }
  );
}

function registerBrandTimezoneGetRoute(fastify: FastifyInstance) {
  fastify.get(
    '/api/brands/:brandId/timezone',
    { preHandler: fastify.authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const userId = request.user!.id;
        const { brandId } = request.params as { brandId: string };
        const brand = await assertBrandOwnership(userId, brandId);
        return { timezone: brand.postingTimezone };
      } catch (err: unknown) {
        request.log.error({ err }, 'Failed to get brand timezone');
        return reply.code(500).send({ error: 'Internal server error' });
      }
    }
  );
}

function registerBrandTimezonePatchRoute(fastify: FastifyInstance) {
  fastify.patch(
    '/api/brands/:brandId/timezone',
    { preHandler: fastify.authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const userId = request.user!.id;
        const { brandId } = request.params as { brandId: string };

        const validatedData = validateBrandTimezoneUpdate(request.body);
        if (!validatedData) {
          return reply.status(400).send({
            error: 'Invalid request body. Expected { timezone: string | null }',
          });
        }

        const { timezone } = validatedData;
        await assertBrandOwnership(userId, brandId);

        if (timezone && !TimezoneService.isValidTimezone(timezone)) {
          return reply.status(400).send({ error: 'Invalid timezone' });
        }

        const updatedBrand = await prisma.brand.update({
          where: { id: brandId },
          data: {
            postingTimezone: timezone,
          },
          select: {
            id: true,
            postingTimezone: true,
          },
        });

        return { success: true, brand: updatedBrand };
      } catch (err: unknown) {
        request.log.error({ err }, 'Failed to update brand timezone');
        return reply.code(500).send({ error: 'Internal server error' });
      }
    }
  );
}

function registerUserRoutes(fastify: FastifyInstance) {
  registerSidebarWidthRoute(fastify);
  registerUserTimezoneRoute(fastify);
  registerThemeRoute(fastify);
  registerWeekStartRoute(fastify);
  registerBrandTimezoneGetRoute(fastify);
  registerBrandTimezonePatchRoute(fastify);
}

const userRoutes: FastifyPluginAsync = async (fastify) => {
  registerUserRoutes(fastify);
};

export default userRoutes;
