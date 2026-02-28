import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { getTokenService } from '../services/service-clients.js';
import { resolvePrimarySocialAccount } from '../services/social-account-resolver.js';

// Token encryption configuration
const ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error('TOKEN_ENCRYPTION_KEY environment variable is required for token encryption');
}

// Validate encryption key format (256 bits = 64 hex characters for AES-256)
if (!/^[0-9a-fA-F]{64}$/.test(ENCRYPTION_KEY)) {
  throw new Error(
    'TOKEN_ENCRYPTION_KEY must be exactly 64 hexadecimal characters (256 bits). ' +
      "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  );
}

// Request schema
const GetTokenSchema = z.object({
  brandId: z.string().min(1),
  platform: z.enum(['instagram', 'facebook', 'linkedin']),
  requesterId: z.string().min(1), // User ID making the request
});

// Response schema
const TokenResponseSchema = z.object({
  accessToken: z.string(),
  expiresAt: z.string().optional(),
  accountId: z.string().optional(),
  pageId: z.string().optional(),
});

type InternalTokenRequest = z.infer<typeof GetTokenSchema>;

function parseBrandPreferences(preferences: unknown) {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
    return null;
  }
  return preferences as Record<string, unknown>;
}

function computeDaysUntilExpiry(expiresAt: string) {
  const expiryDate = new Date(expiresAt);
  return Math.floor((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

async function emitInstagramTokenExpiryNotification(params: {
  brand: { id: string; user: { id: string } };
  daysUntilExpiry: number;
  fastify: any;
}) {
  const severity = params.daysUntilExpiry <= 1 ? 'error' : 'warning';
  const title =
    params.daysUntilExpiry <= 1 ? 'Instagram token expiring soon' : 'Instagram token expiring';
  const body =
    params.daysUntilExpiry <= 1
      ? 'Your Instagram access token expires within 24 hours. Reconnect to avoid publishing failures.'
      : `Your Instagram access token expires in ${params.daysUntilExpiry} days. Consider reconnecting to avoid disruptions.`;

  try {
    const { notificationsService } = await import('../services/notifications.js');
    await notificationsService.emitEvent({
      userId: params.brand.user.id,
      brandId: params.brand.id,
      type: 'accounts.token_expiring',
      category: 'accounts',
      severity,
      title,
      body,
      linkUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/brands`,
    });
  } catch (error: unknown) {
    params.fastify.log.error({ err: error }, 'Failed to emit token expiring notification');
  }
}

async function resolveTokenForBrandPlatform(params: {
  brand: { id: string; user: { id: string } };
  platform: InternalTokenRequest['platform'];
}) {
  const tokenServiceClient = await getTokenService();
  const primaryAccount =
    params.platform === 'instagram' || params.platform === 'facebook'
      ? await resolvePrimarySocialAccount(params.brand.id, params.platform)
      : null;
  const token =
    primaryAccount && (params.platform === 'instagram' || params.platform === 'facebook')
      ? await tokenServiceClient.getTokenForSocialAccount(
          params.brand.user.id,
          params.brand.id,
          params.platform,
          primaryAccount.id
        )
      : await tokenServiceClient.getToken(params.brand.user.id, params.brand.id, params.platform);

  return { token, primaryAccount };
}

async function buildInstagramTokenData(params: {
  token: { accessToken: string; metadata?: Record<string, any> };
  primaryAccount: { externalAccountId?: string | null; externalPageId?: string | null } | null;
  brand: { id: string; user: { id: string }; preferences?: unknown };
  fastify: any;
}) {
  const tokenData: {
    accessToken: string;
    accountId?: string | null;
    pageId?: string | null;
    expiresAt?: string;
  } = {
    accessToken: params.token.accessToken,
    accountId: params.token.metadata?.accountId || params.primaryAccount?.externalAccountId,
    pageId: params.token.metadata?.pageId || params.primaryAccount?.externalPageId,
  };

  const preferences = parseBrandPreferences(params.brand.preferences);
  const tokenExpiresAt =
    preferences && typeof preferences.tokenExpiresAt === 'string'
      ? preferences.tokenExpiresAt
      : undefined;
  if (!tokenExpiresAt) {
    return tokenData;
  }

  tokenData.expiresAt = tokenExpiresAt;
  const daysUntilExpiry = computeDaysUntilExpiry(tokenExpiresAt);
  if (daysUntilExpiry >= 7) {
    return tokenData;
  }

  params.fastify.log.info({
    action: 'token.refresh.needed',
    brandId: params.brand.id,
    platform: 'instagram',
    daysUntilExpiry,
  });
  params.fastify.log.warn(
    `Instagram token for brand ${params.brand.id} expires in ${daysUntilExpiry} days`
  );
  await emitInstagramTokenExpiryNotification({
    brand: params.brand,
    daysUntilExpiry,
    fastify: params.fastify,
  });
  return tokenData;
}

async function loadAuthorizedBrand(params: { brandId: string; requesterId: string; fastify: any }) {
  const brand = await prisma.brand.findUnique({
    where: { id: params.brandId },
    include: { user: { select: { id: true, email: true } } },
  });
  if (brand?.userId === params.requesterId) {
    return brand;
  }

  params.fastify.log.warn({
    action: 'token.access.denied',
    reason: !brand ? 'brand_not_found' : 'unauthorized',
    brandId: params.brandId,
    requesterId: params.requesterId,
    actualOwnerId: brand?.userId,
  });
  return null;
}

function createInternalTokenGetHandler(fastify: any) {
  return async (request: any, reply: any) => {
    try {
      const { brandId, platform, requesterId } = GetTokenSchema.parse(request.body);
      fastify.log.info({
        action: 'token.access.requested',
        brandId,
        platform,
        requesterId,
        source: request.headers['user-agent'] || 'unknown',
        ip: request.ip,
      });

      const brand = await loadAuthorizedBrand({ brandId, requesterId, fastify });
      if (!brand) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      const { token, primaryAccount } = await resolveTokenForBrandPlatform({ brand, platform });
      if (!token) {
        return reply.code(404).send({ error: `No ${platform} token found for brand` });
      }

      if (platform === 'facebook') {
        return reply.code(501).send({ error: 'Facebook platform not yet implemented' });
      }
      if (platform === 'linkedin') {
        return reply.code(501).send({ error: 'LinkedIn platform not yet implemented' });
      }

      const tokenData = await buildInstagramTokenData({
        token,
        primaryAccount,
        brand,
        fastify,
      });
      fastify.log.info({ action: 'token.access.granted', brandId, platform, requesterId });
      return reply.send(TokenResponseSchema.parse(tokenData));
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid request', details: error.issues });
      }
      fastify.log.error({
        action: 'token.access.error',
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return reply.code(500).send({ error: 'Internal server error' });
    }
  };
}

const internalTokenRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/api/internal/tokens/get',
    { preHandler: fastify.authenticate },
    createInternalTokenGetHandler(fastify)
  );
};

export default internalTokenRoutes;
