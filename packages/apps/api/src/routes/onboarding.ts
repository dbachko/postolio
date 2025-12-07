import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseClient } from '../config/database.js';
import { seedDemoWorkspace, type DemoVariantId } from '../services/demo-seed.js';
import { isDemoBrand } from '../utils/demo-brand.js';

const prisma = getDatabaseClient();

type OnboardingStatus = 'no_brand' | 'brand_no_social' | 'complete' | 'demo';

interface OnboardingResponse {
  status: OnboardingStatus;
  realBrandCount: number;
  instagramConnected: boolean;
  activeBrandId: string | null;
  demoBrandId: string | null;
}

function isDemoSocialAccount(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  const meta = metadata as Record<string, unknown>;
  return typeof meta.isDemo === 'boolean' ? meta.isDemo : false;
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
            preferences: true,
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
            instagramConnected: false,
            activeBrandId: null,
            demoBrandId: null,
          };
          return reply.send(payload);
        }

        const demoBrands = brands.filter((b) => isDemoBrand(b.preferences));
        const realBrands = brands.filter((b) => !isDemoBrand(b.preferences));

        const realBrandCount = realBrands.length;

        const firstDemoBrand = demoBrands[0] ?? null;

        const hasRealInstagram = realBrands.some((b) =>
          b.socialAccounts.some((sa) => {
            const disconnected =
              sa.metadata && typeof sa.metadata === 'object'
                ? Boolean((sa.metadata as any).disconnected)
                : false;
            return (
              sa.platform === 'instagram' && !disconnected && !isDemoSocialAccount(sa.metadata)
            );
          })
        );

        let status: OnboardingStatus;
        let activeBrandId: string | null = null;
        const demoBrandId: string | null = firstDemoBrand?.id ?? null;

        if (realBrandCount === 0 && firstDemoBrand) {
          status = 'demo';
          activeBrandId = firstDemoBrand.id;
        } else if (realBrandCount === 0) {
          status = 'no_brand';
        } else if (hasRealInstagram) {
          status = 'complete';
          const brandWithIg = realBrands.find((b) =>
            b.socialAccounts.some((sa) => {
              const disconnected =
                sa.metadata && typeof sa.metadata === 'object'
                  ? Boolean((sa.metadata as any).disconnected)
                  : false;
              return (
                sa.platform === 'instagram' && !disconnected && !isDemoSocialAccount(sa.metadata)
              );
            })
          );
          activeBrandId = brandWithIg?.id ?? realBrands[0]?.id ?? null;
        } else {
          status = 'brand_no_social';
          activeBrandId = realBrands[0]?.id ?? null;
        }

        const payload: OnboardingResponse = {
          status,
          realBrandCount,
          instagramConnected: hasRealInstagram,
          activeBrandId,
          demoBrandId,
        };

        return reply.send(payload);
      } catch (error) {
        request.log.error({ err: error }, 'Failed to compute onboarding status');
        return reply.code(500).send({ error: 'Failed to compute onboarding status' });
      }
    }
  );

  // POST /api/onboarding/demo
  // Create or reuse a demo brand and a demo Instagram social account.
  fastify.post(
    '/api/onboarding/demo',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;

      try {
        const variant: DemoVariantId = 'default';
        const brands = await prisma.brand.findMany({
          where: { userId },
          select: {
            id: true,
            name: true,
            preferences: true,
            socialAccounts: {
              select: {
                id: true,
                platform: true,
                metadata: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        });

        // If user already has a real brand, we do not force demo mode.
        const hasRealBrand = brands.some((b) => !isDemoBrand(b.preferences));
        if (hasRealBrand) {
          return reply.code(400).send({
            error: 'demo_not_allowed_with_real_brand',
            message: 'Demo mode is intended for new accounts without any real brands.',
          });
        }

        // Reuse existing demo brand if present.
        let demoBrand = brands.find((b) => isDemoBrand(b.preferences)) ?? null;

        if (!demoBrand) {
          demoBrand = await prisma.brand.create({
            data: {
              name: 'Postolio Demo Brand',
              description: 'Sample brand for exploring Postolio features with demo data.',
              userId,
              preferences: {
                isDemo: true,
                demoVariant: variant,
                onboarding: {
                  isDemo: true,
                  createdAt: new Date().toISOString(),
                },
              },
            },
            select: {
              id: true,
              name: true,
              preferences: true,
              socialAccounts: {
                select: {
                  id: true,
                  platform: true,
                  metadata: true,
                },
              },
            },
          });
        }

        if (!demoBrand) {
          throw new Error('Failed to ensure demo brand for demo mode');
        }

        // Ensure a demo Instagram social account exists.
        const existingDemoSocial = await prisma.socialAccount.findFirst({
          where: {
            brandId: demoBrand.id,
            platform: 'instagram',
          },
        });

        let socialAccountId = existingDemoSocial?.id ?? null;

        if (!existingDemoSocial) {
          const demoExternalId = `demo-instagram-${demoBrand.id}`;
          const social = await prisma.socialAccount.create({
            data: {
              brandId: demoBrand.id,
              platform: 'instagram',
              externalAccountId: demoExternalId,
              externalPageId: null,
              username: 'postolio_demo',
              displayName: demoBrand.name,
              metadata: {
                isDemo: true,
                disconnected: false,
                followers_count: 12345,
                media_count: 120,
                biography: 'Demo Instagram account used to showcase Postolio features.',
              },
            },
            select: {
              id: true,
            },
          });
          socialAccountId = social.id;
        } else if (!isDemoSocialAccount(existingDemoSocial.metadata)) {
          // If an existing account is not flagged as demo, mark it as demo to avoid accidental real usage.
          const updated = await prisma.socialAccount.update({
            where: { id: existingDemoSocial.id },
            data: {
              metadata: {
                ...(existingDemoSocial.metadata as Record<string, unknown>),
                isDemo: true,
              },
            },
            select: { id: true },
          });
          socialAccountId = updated.id;
        }

        // Seed demo workspace content for this brand (idempotent).
        await seedDemoWorkspace({
          brandId: demoBrand.id,
          userId,
          variantId: variant,
        });

        const response: OnboardingResponse = {
          status: 'demo',
          realBrandCount: 0,
          instagramConnected: true,
          activeBrandId: demoBrand.id,
          demoBrandId: demoBrand.id,
        };

        return reply.code(201).send({
          onboarding: response,
          demoBrand: {
            id: demoBrand.id,
            name: demoBrand.name,
          },
          demoSocialAccountId: socialAccountId,
        });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to enable demo mode');
        return reply.code(500).send({ error: 'Failed to enable demo mode' });
      }
    }
  );
};

export default onboardingRoutes;
