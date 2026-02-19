import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();

type OnboardingStatus = 'no_brand' | 'brand_no_social' | 'complete';

interface OnboardingResponse {
  status: OnboardingStatus;
  realBrandCount: number;
  socialConnected: boolean;
  instagramConnected: boolean;
  activeBrandId: string | null;
}

function isSocialAccountDisconnected(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  return Boolean((metadata as Record<string, unknown>).disconnected);
}

const onboardingRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/onboarding/status
  // Derive onboarding state from brands + social accounts.
  fastify.get(
    '/api/onboarding/status',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;

      try {
        const brands = await prisma.brand.findMany({
          where: { userId },
          select: {
            id: true,
            socialAccounts: {
              select: {
                platform: true,
                metadata: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        });

        if (brands.length === 0) {
          const payload: OnboardingResponse = {
            status: 'no_brand',
            realBrandCount: 0,
            socialConnected: false,
            instagramConnected: false,
            activeBrandId: null,
          };
          return reply.send(payload);
        }

        const realBrandCount = brands.length;

        const hasInstagram = brands.some((brand) =>
          brand.socialAccounts.some(
            (sa) => sa.platform === 'instagram' && !isSocialAccountDisconnected(sa.metadata)
          )
        );

        const hasSocialConnected = brands.some((brand) =>
          brand.socialAccounts.some((sa) => !isSocialAccountDisconnected(sa.metadata))
        );

        let status: OnboardingStatus;
        let activeBrandId: string | null = null;

        if (hasSocialConnected) {
          status = 'complete';
          const brandWithSocial = brands.find((brand) =>
            brand.socialAccounts.some((sa) => !isSocialAccountDisconnected(sa.metadata))
          );
          activeBrandId = brandWithSocial?.id ?? brands[0]?.id ?? null;
        } else {
          status = 'brand_no_social';
          activeBrandId = brands[0]?.id ?? null;
        }

        const payload: OnboardingResponse = {
          status,
          realBrandCount,
          socialConnected: hasSocialConnected,
          instagramConnected: hasInstagram,
          activeBrandId,
        };

        return reply.send(payload);
      } catch (error) {
        request.log.error({ err: error }, 'Failed to compute onboarding status');
        return reply.code(500).send({ error: 'Failed to compute onboarding status' });
      }
    }
  );
};

export default onboardingRoutes;
