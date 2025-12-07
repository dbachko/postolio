import { FastifyPluginAsync } from 'fastify';
import { getDatabaseClient } from '../config/database.js';
import { isDemoBrand } from '../utils/demo-brand.js';

// Lightweight proxy endpoints for account-scoped utilities
const accountRoutes: FastifyPluginAsync = async (fastify) => {
  // Alias for schedule-ahead limits: /api/account/limits/schedule-ahead
  fastify.get(
    '/limits/schedule-ahead',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const r = await fastify.inject({
        method: 'GET',
        url: '/api/content/limits/schedule-ahead',
        headers: { cookie: request.headers.cookie as string },
      });
      return reply.code(r.statusCode).send(r.json());
    }
  );

  // Brand-level schedule-ahead breakdown for current user
  fastify.get(
    '/limits/schedule-ahead/by-brand',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const prisma = getDatabaseClient();
        const userId = request.user!.id;
        const now = new Date();

        // Fetch user's brands for names and demo flag
        const brands = await prisma.brand.findMany({
          where: { userId },
          select: { id: true, name: true, preferences: true },
        });

        const realBrands = brands.filter((b) => !isDemoBrand(b.preferences));
        if (realBrands.length === 0) return reply.send({ success: true, data: [] });

        const realBrandIds = realBrands.map((b) => b.id);

        // Group counts of future drafts/scheduled by brand
        const grouped = await prisma.content.groupBy({
          by: ['brandId', 'status'],
          where: {
            brandId: { in: realBrandIds },
            scheduledAt: { gte: now },
            status: { in: ['scheduled', 'draft'] },
          },
          _count: { _all: true },
        });

        const brandMap = new Map<string, { name: string; scheduled: number; draft: number }>();
        for (const b of realBrands) {
          brandMap.set(b.id, { name: b.name, scheduled: 0, draft: 0 });
        }
        for (const row of grouped) {
          const entry = brandMap.get(row.brandId);
          if (!entry) continue;
          if (row.status === 'scheduled') entry.scheduled += row._count._all as number;
          else if (row.status === 'draft') entry.draft += row._count._all as number;
        }

        const data = Array.from(brandMap.entries()).map(([brandId, v]) => ({
          brandId,
          brandName: v.name,
          scheduled: v.scheduled,
          draft: v.draft,
          totalFuture: v.scheduled + v.draft,
        }));

        return reply.send({ success: true, data });
      } catch (error) {
        request.log.error({ error }, 'Failed to compute per-brand limits');
        return reply.code(500).send({ success: false, error: 'Failed to get per-brand limits' });
      }
    }
  );
};

export default accountRoutes;
