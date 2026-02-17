import { FastifyPluginAsync } from 'fastify';
import { getDatabaseClient } from '../config/database.js';
import { assertBrandOwnership } from '../services/ownership.js';
import { getTokenService } from '../services/service-clients.js';
import { PublisherCredentialsService } from '../services/publisher-credentials.js';
import { isMultiDestinationEnabledForUser } from '../utils/feature-flags.js';

const prisma = getDatabaseClient();

type TokenStatus = 'healthy' | 'expiring' | 'expired' | 'unknown' | 'disconnected';

function normalizePreferences(preferences: unknown): Record<string, unknown> {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return {};
  return preferences as Record<string, unknown>;
}

function normalizeDefaultPostSocialAccountIds(preferences: Record<string, unknown>): string[] {
  const raw = (preferences as any).defaultPostSocialAccountIds;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const id = v.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function isDisconnected(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  return (metadata as any).disconnected === true;
}

function extractTokenExpiresAt(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const direct = (metadata as any).tokenExpiresAt;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const nested = (metadata as any).token?.expiresAt;
  if (typeof nested === 'string' && nested.trim()) return nested.trim();
  return null;
}

function computeTokenStatus(metadata: unknown): {
  tokenExpiresAt: string | null;
  tokenStatus: TokenStatus;
} {
  const tokenExpiresAt = extractTokenExpiresAt(metadata);
  if (isDisconnected(metadata)) {
    return { tokenExpiresAt, tokenStatus: 'disconnected' };
  }
  if (!tokenExpiresAt) {
    return { tokenExpiresAt: null, tokenStatus: 'unknown' };
  }
  const expiryDate = new Date(tokenExpiresAt);
  if (Number.isNaN(expiryDate.getTime())) {
    return { tokenExpiresAt, tokenStatus: 'unknown' };
  }
  const now = Date.now();
  const expiresAtMs = expiryDate.getTime();
  if (expiresAtMs <= now) {
    return { tokenExpiresAt, tokenStatus: 'expired' };
  }
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  if (expiresAtMs - now <= sevenDaysMs) {
    return { tokenExpiresAt, tokenStatus: 'expiring' };
  }
  return { tokenExpiresAt, tokenStatus: 'healthy' };
}

const brandsSocialAccountsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/brands/:brandId/social-accounts
  fastify.get<{ Params: { brandId: string } }>(
    '/:brandId/social-accounts',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params;
      const userId = request.user!.id;
      const email = (request.user as any)?.email ?? null;

      const brand = await assertBrandOwnership(userId, brandId);
      const preferences = normalizePreferences(brand.preferences);
      const defaultPostSocialAccountIds = normalizeDefaultPostSocialAccountIds(preferences);
      const multiDestinationEnabled = isMultiDestinationEnabledForUser({ userId, email });

      const socialAccounts = await prisma.socialAccount.findMany({
        where: { brandId },
        select: {
          id: true,
          platform: true,
          externalAccountId: true,
          externalPageId: true,
          username: true,
          displayName: true,
          metadata: true,
          sortOrder: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });

      const items = socialAccounts.map((sa) => {
        const meta = (sa.metadata || {}) as Record<string, unknown>;
        const disconnected = meta?.disconnected === true;
        const token = computeTokenStatus(meta);
        const profileData =
          meta.profileData &&
          typeof meta.profileData === 'object' &&
          !Array.isArray(meta.profileData)
            ? (meta.profileData as Record<string, unknown>)
            : null;
        const profilePictureUrl = (() => {
          const direct = meta.profile_picture_url;
          if (typeof direct === 'string' && direct) return direct;
          const nested = profileData?.profile_picture_url;
          if (typeof nested === 'string' && nested) return nested;
          return null;
        })();

        return {
          id: sa.id,
          platform: sa.platform,
          externalAccountId: sa.externalAccountId,
          externalPageId: sa.externalPageId,
          username: sa.username,
          displayName: sa.displayName,
          profilePictureUrl,
          disconnected,
          tokenStatus: token.tokenStatus,
          tokenExpiresAt: token.tokenExpiresAt,
          metadata: sa.metadata,
          sortOrder: sa.sortOrder,
          createdAt: sa.createdAt,
          updatedAt: sa.updatedAt,
        };
      });

      const itemById = new Map(items.map((item) => [item.id, item]));
      let normalizedDefaultPostIds = defaultPostSocialAccountIds.filter((id) => {
        const item = itemById.get(id);
        if (!item || item.disconnected) return false;
        if (!multiDestinationEnabled && String(item.platform || '').toLowerCase() !== 'instagram') {
          return false;
        }
        return true;
      });
      if (!multiDestinationEnabled && normalizedDefaultPostIds.length > 1) {
        normalizedDefaultPostIds = [normalizedDefaultPostIds[0]!];
      }

      const primarySocialAccountId =
        items.find(
          (a) =>
            !a.disconnected &&
            (multiDestinationEnabled || String(a.platform || '').toLowerCase() === 'instagram')
        )?.id ?? null;

      return reply.send({
        brandId,
        primarySocialAccountId,
        defaultPostSocialAccountIds: normalizedDefaultPostIds,
        socialAccounts: items,
      });
    }
  );

  // POST /api/brands/:brandId/social-accounts/default-post-social-accounts
  fastify.post<{ Params: { brandId: string }; Body: { socialAccountIds?: unknown } }>(
    '/:brandId/social-accounts/default-post-social-accounts',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params;
      const userId = request.user!.id;
      const email = (request.user as any)?.email ?? null;
      const brand = await assertBrandOwnership(userId, brandId);
      const multiDestinationEnabled = isMultiDestinationEnabledForUser({ userId, email });

      const preferences = normalizePreferences(brand.preferences);
      const requested = (() => {
        const raw = request.body?.socialAccountIds;
        if (!Array.isArray(raw)) return [] as string[];
        const seen = new Set<string>();
        const out: string[] = [];
        for (const v of raw) {
          if (typeof v !== 'string') continue;
          const id = v.trim();
          if (!id || seen.has(id)) continue;
          seen.add(id);
          out.push(id);
        }
        return out;
      })();

      let allowed: string[] = [];
      if (requested.length > 0) {
        const accounts = await prisma.socialAccount.findMany({
          where: { brandId, id: { in: requested } },
          select: { id: true, metadata: true, platform: true },
        });
        const allowedSet = new Set(
          accounts
            .filter((a) => !isDisconnected(a.metadata))
            .filter(
              (a) =>
                multiDestinationEnabled || String(a.platform || '').toLowerCase() === 'instagram'
            )
            .map((a) => a.id)
        );
        allowed = requested.filter((id) => allowedSet.has(id));
      }
      if (!multiDestinationEnabled && allowed.length > 1) {
        allowed = [allowed[0]!];
      }

      await prisma.brand.update({
        where: { id: brandId },
        data: {
          preferences: {
            ...preferences,
            defaultPostSocialAccountIds: allowed,
          },
        },
      });

      return reply.send({
        success: true,
        brandId,
        defaultPostSocialAccountIds: allowed,
      });
    }
  );

  // POST /api/brands/:brandId/social-accounts/order
  // Persists the display order for social accounts (top = primary/default when no explicit defaults).
  fastify.post<{ Params: { brandId: string }; Body: { orderedIds?: unknown } }>(
    '/:brandId/social-accounts/order',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params;
      const userId = request.user!.id;
      await assertBrandOwnership(userId, brandId);

      const raw = request.body?.orderedIds;
      if (!Array.isArray(raw)) {
        return reply.code(400).send({ error: 'invalid_ordered_ids' });
      }

      const requested: string[] = [];
      const seen = new Set<string>();
      for (const v of raw) {
        if (typeof v !== 'string') continue;
        const id = v.trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        requested.push(id);
      }

      const accounts = await prisma.socialAccount.findMany({
        where: { brandId },
        select: { id: true, metadata: true, sortOrder: true, createdAt: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
      const byId = new Map(accounts.map((a) => [a.id, a]));
      const connectedIdsInBrandOrder = accounts
        .filter((a) => !isDisconnected(a.metadata))
        .map((a) => a.id);

      const nextOrderedConnected: string[] = [];
      for (const id of requested) {
        const account = byId.get(id);
        if (!account) continue;
        if (isDisconnected(account.metadata)) continue;
        nextOrderedConnected.push(id);
      }
      for (const id of connectedIdsInBrandOrder) {
        if (!nextOrderedConnected.includes(id)) nextOrderedConnected.push(id);
      }

      await prisma.$transaction(
        nextOrderedConnected.map((id, idx) =>
          prisma.socialAccount.update({
            where: { id },
            data: { sortOrder: idx },
          })
        )
      );

      // Invalidate publisher credentials cache since ordering changes affect default selection.
      try {
        await PublisherCredentialsService.invalidateCredentialsCache(brandId);
      } catch {
        // best-effort
      }

      return reply.send({
        success: true,
        brandId,
        orderedIds: nextOrderedConnected,
      });
    }
  );

  // GET /api/brands/:brandId/social-accounts/meta/authorize
  // Alias for /api/auth/meta/authorize?brandId=...
  fastify.get<{ Params: { brandId: string } }>(
    '/:brandId/social-accounts/meta/authorize',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params;
      const userId = request.user!.id;
      await assertBrandOwnership(userId, brandId);

      const parentOrigin = (() => {
        const origin = request.headers.origin;
        if (typeof origin === 'string' && origin.trim()) {
          try {
            return new URL(origin).origin;
          } catch {
            // ignore
          }
        }
        const referer = request.headers.referer;
        if (typeof referer === 'string' && referer.trim()) {
          try {
            return new URL(referer).origin;
          } catch {
            // ignore
          }
        }
        return null;
      })();

      const url =
        `/api/auth/meta/authorize?brandId=${encodeURIComponent(brandId)}` +
        (parentOrigin ? `&parentOrigin=${encodeURIComponent(parentOrigin)}` : '');

      const r = await fastify.inject({
        method: 'GET',
        url,
        headers: { cookie: request.headers.cookie as string },
      });
      return reply.code(r.statusCode).send(r.json());
    }
  );

  // POST /api/brands/:brandId/social-accounts/:socialAccountId/disconnect
  fastify.post<{
    Params: { brandId: string; socialAccountId: string };
    Body: { removeImportedPosts?: boolean };
  }>(
    '/:brandId/social-accounts/:socialAccountId/disconnect',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId, socialAccountId } = request.params;
      const userId = request.user!.id;
      const removeImportedPosts = request.body?.removeImportedPosts === true;

      const brand = await prisma.brand.findFirst({
        where: { id: brandId, userId },
        select: { id: true, userId: true, preferences: true },
      });
      if (!brand) {
        return reply.code(404).send({ error: 'brand_not_found' });
      }

      const socialAccount = await prisma.socialAccount.findFirst({
        where: { id: socialAccountId, brandId },
        select: {
          id: true,
          platform: true,
          externalAccountId: true,
          username: true,
          metadata: true,
        },
      });
      if (!socialAccount) {
        return reply.code(404).send({ error: 'social_account_not_found' });
      }

      const existingMetadata = (socialAccount.metadata || {}) as Record<string, unknown>;
      await prisma.socialAccount.update({
        where: { id: socialAccountId },
        data: {
          metadata: {
            ...existingMetadata,
            disconnected: true,
            disconnectedAt: new Date().toISOString(),
          },
        },
      });

      // Delete token from token-service (best-effort)
      try {
        const tokenService = await getTokenService();
        await tokenService.deleteTokenForSocialAccount(
          brand.userId,
          brand.id,
          String(socialAccount.platform),
          socialAccountId
        );
      } catch (e) {
        request.log.warn({ err: e }, 'Failed to delete account token during disconnect');
      }

      // Invalidate publisher credentials cache since tokens may have changed
      try {
        await PublisherCredentialsService.invalidateCredentialsCache(brandId);
      } catch {
        // best-effort
      }

      // Optional: remove imported posts from this social account
      if (removeImportedPosts) {
        try {
          const platform = String(socialAccount.platform);
          const source = platform === 'instagram' ? 'instagram_import' : `${platform}_import`;
          const importedContent = await prisma.content.findMany({
            where: {
              brandId,
              generationParams: { path: ['source'], equals: source },
              publications: {
                some: { socialAccountId, platform: socialAccount.platform as any },
              },
            },
            select: { id: true },
          });
          const importedIds = importedContent.map((c) => c.id);
          if (importedIds.length > 0) {
            await prisma.content.deleteMany({ where: { id: { in: importedIds } } });
          }
        } catch (e) {
          request.log.warn(
            { err: e },
            'Failed to remove imported posts on social account disconnect'
          );
        }
      }

      return reply.send({
        success: true,
        brandId,
        socialAccountId,
      });
    }
  );
};

export default brandsSocialAccountsRoutes;
