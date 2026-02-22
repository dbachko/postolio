import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { getDatabaseClient } from '../config/database.js';
import type { ThemePreference, WeekStartPreference } from '@postolio/database';
import { TimezoneService } from '../services/timezone.js';
import { assertBrandOwnership } from '../services/ownership.js';

const prisma = getDatabaseClient();

// Type guards for proper input validation
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

// Theme update body guard (single field)
function isThemeUpdateBody(body: unknown): body is { theme: 'system' | 'light' | 'dark' } {
  if (!body || typeof body !== 'object') {
    return false;
  }
  const obj = body as Record<string, unknown>;
  const theme = obj.theme;
  return theme === 'system' || theme === 'light' || theme === 'dark';
}

// Week start update body guard
function isWeekStartUpdateBody(body: unknown): body is { weekStart: 'monday' | 'sunday' } {
  if (!body || typeof body !== 'object') {
    return false;
  }
  const obj = body as Record<string, unknown>;
  return obj.weekStart === 'monday' || obj.weekStart === 'sunday';
}

// Validation helpers using type guards
function validateTimezoneUpdate(
  body: unknown
): { timezone: string; timezoneAutoDetected: boolean } | null {
  if (isTimezoneUpdateBody(body)) {
    return body;
  }
  return null;
}

function validateBrandTimezoneUpdate(body: unknown): { timezone: string | null } | null {
  if (isBrandTimezoneUpdateBody(body)) {
    return body;
  }
  return null;
}

function validateThemeUpdate(body: unknown): { theme: 'system' | 'light' | 'dark' } | null {
  if (isThemeUpdateBody(body)) {
    return body as { theme: 'system' | 'light' | 'dark' };
  }
  return null;
}

function validateWeekStartUpdate(body: unknown): { weekStart: 'monday' | 'sunday' } | null {
  if (isWeekStartUpdateBody(body)) {
    return body as { weekStart: 'monday' | 'sunday' };
  }
  return null;
}

const userRoutes: FastifyPluginAsync = async (fastify) => {
  // Update user UI preferences: right sidebar width per type
  fastify.patch(
    '/api/users/ui/sidebar-width',
    { preHandler: fastify.authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user!.id;
      try {
        const body = request.body as { type?: string; width?: number };
        const type = typeof body?.type === 'string' ? (body.type as string) : null;
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
        const right: Record<string, unknown> =
          (prefs.rightSidebar as Record<string, unknown>) || {};
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

  // Update user timezone preferences
  fastify.patch(
    '/api/users/timezone',
    { preHandler: fastify.authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user!.id;

      try {
        // Validate request body
        const validatedData = validateTimezoneUpdate(request.body);
        if (!validatedData) {
          return reply.status(400).send({
            error:
              'Invalid request body. Expected { timezone: string, timezoneAutoDetected: boolean }',
          });
        }

        const { timezone, timezoneAutoDetected } = validatedData;

        // Validate timezone if not auto-detected
        if (!timezoneAutoDetected && !TimezoneService.isValidTimezone(timezone)) {
          return reply.status(400).send({ error: 'Invalid timezone' });
        }

        const updatedUser = await prisma.user.update({
          where: { id: userId },
          data: {
            timezone, // Store the actual timezone value even when auto-detected
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

  // Update user theme preference (system|light|dark)
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

        const { theme } = validated;

        const updatedUser = await prisma.user.update({
          where: { id: userId },
          data: {
            themePreference: theme as unknown as ThemePreference,
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

  // Update user week start preference (monday|sunday)
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

        const { weekStart } = validated;

        const updatedUser = await prisma.user.update({
          where: { id: userId },
          data: {
            weekStartPreference: weekStart as WeekStartPreference,
          },
          select: { id: true, weekStartPreference: true },
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

  // Get brand timezone
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

  // Update brand timezone
  fastify.patch(
    '/api/brands/:brandId/timezone',
    { preHandler: fastify.authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const userId = request.user!.id;
        const { brandId } = request.params as { brandId: string };

        // Validate request body
        const validatedData = validateBrandTimezoneUpdate(request.body);
        if (!validatedData) {
          return reply.status(400).send({
            error: 'Invalid request body. Expected { timezone: string | null }',
          });
        }

        const { timezone } = validatedData;

        await assertBrandOwnership(userId, brandId);

        // Validate timezone if provided
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
};

export default userRoutes;
