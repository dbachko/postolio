import { FastifyPluginAsync } from 'fastify';
import { getDatabaseClient } from '../config/database.js';
import type { Prisma } from '@postolio/database';
import { assertBrandOwnership } from '../services/ownership.js';

const prisma = getDatabaseClient();

const brandStyleRoutes: FastifyPluginAsync = async (fastify) => {
  // Get freeze-core flag from Brand.preferences JSON
  fastify.get<{ Params: { brandId: string } }>(
    '/:brandId/style/freeze-core',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params;
      const brand = await assertBrandOwnership(request.user!.id, brandId);
      type BrandPreferences = Record<string, unknown> & { profileFreezeCore?: boolean };
      const prefsRaw = brand.preferences as unknown;
      const prefs: BrandPreferences =
        prefsRaw && typeof prefsRaw === 'object' ? (prefsRaw as BrandPreferences) : {};
      // Smart Freeze default ON when unset
      const freezeCore = prefs.profileFreezeCore !== false;
      return reply.send({ freezeCore });
    }
  );

  // Update freeze-core flag in Brand.preferences JSON (merge update)
  fastify.patch<{ Params: { brandId: string }; Body: { freezeCore?: boolean } }>(
    '/:brandId/style/freeze-core',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params;
      const { freezeCore } = request.body || {};
      if (typeof freezeCore !== 'boolean') {
        return reply.code(400).send({ error: 'freezeCore boolean required' });
      }
      const brand = await assertBrandOwnership(request.user!.id, brandId);
      type BrandPreferences = Record<string, unknown> & { profileFreezeCore?: boolean };
      const prefsRaw = brand.preferences as unknown;
      const prefs: BrandPreferences =
        prefsRaw && typeof prefsRaw === 'object' ? (prefsRaw as BrandPreferences) : {};
      prefs.profileFreezeCore = freezeCore;
      await prisma.brand.update({
        where: { id: brandId },
        data: { preferences: prefs as unknown as Prisma.InputJsonValue },
      });
      return reply.send({ freezeCore });
    }
  );
};

export default brandStyleRoutes;
