import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { captureException, captureMessage } from '@postolio/observability';
import { Prisma } from '@postolio/database';

import { getDatabaseClient } from '../config/database.js';
import { redisService } from '../services/redis.js';
import { assertBrandOwnership } from '../services/ownership.js';
import { getTokenService } from '../services/service-clients.js';
import { PublisherCredentialsService } from '../services/publisher-credentials.js';
import { ensureDefaultQueueWithStarterSchedule } from '../services/publishing-queue/default-schedule.js';
import { isMultiDestinationEnabledForUser } from '../utils/feature-flags.js';

const prisma = getDatabaseClient();

// Centralize Facebook Graph API version for Meta OAuth flows
const FB_GRAPH_API_VERSION = process.env.FB_GRAPH_API_VERSION || 'v24.0';
const fbGraph = (path: string) => `https://graph.facebook.com/${FB_GRAPH_API_VERSION}/${path}`;

const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || '';
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || '';
const META_REDIRECT_URI =
  process.env.META_REDIRECT_URI || 'http://localhost:3000/api/auth/meta/callback';

const CONNECT_SESSION_TTL_SECONDS = 15 * 60;

interface AuthorizeQuery {
  brandId: string;
  parentOrigin?: string;
}

interface CallbackQuery {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

interface CandidatesQuery {
  connectSessionId: string;
}

interface FinalizeBody {
  connectSessionId: string;
  candidateIds: string[];
}

type MetaPlatform = 'instagram' | 'facebook';

interface MetaConnectSession {
  connectSessionId: string;
  userId: string;
  brandId: string;
  state: string;
  parentOrigin?: string | null;
  createdAt: string;
}

interface FacebookPage {
  id: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: { id: string };
  connected_instagram_account?: { id: string };
}

interface PagesResponse {
  data?: FacebookPage[];
  paging?: { next?: string };
}

interface InstagramProfile extends Record<string, unknown> {
  id?: string;
  username?: string;
  name?: string;
  biography?: string;
  followers_count?: number;
  media_count?: number;
  profile_picture_url?: string;
}

interface MetaConnectCandidate {
  candidateId: string;
  platform: MetaPlatform;
  externalAccountId: string;
  externalPageId?: string | null;
  username?: string | null;
  displayName?: string | null;
  profilePictureUrl?: string | null;
  metadata?: Record<string, unknown>;
}

interface MetaConnectCandidateToken {
  accessToken: string;
  expiresAt: string;
  metadata?: Record<string, unknown>;
}

function ensureAuth(
  request: FastifyRequest,
  reply: FastifyReply
): request is FastifyRequest & { user: { id: string } } {
  if (!request.user || !request.user.id) {
    reply.code(401).send({ error: 'Authentication required' });
    return false;
  }
  return true;
}

function redactOauthSensitiveDetails(value: string): string {
  return String(value || '')
    .replace(/access_token=[^&\s"]+/gi, 'access_token=[REDACTED]')
    .replace(/client_secret=[^&\s"]+/gi, 'client_secret=[REDACTED]');
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}…`;
}

function isMetadataDisconnected(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  return (metadata as any).disconnected === true;
}

function captureOauthMessage(message: string, context: Record<string, unknown>) {
  captureMessage(message, { module: 'meta-oauth', ...context });
}

function captureOauthException(error: unknown, context: Record<string, unknown>) {
  captureException(error, { module: 'meta-oauth', ...context });
}

function getPopupParentOrigin(): string {
  const appUrl = (process.env.APP_URL || 'https://postolio.example').replace(/\/+$/, '');
  try {
    return new URL(appUrl).origin;
  } catch {
    return '*';
  }
}

function sendMetaPopupSuccessPage(
  reply: FastifyReply,
  payload: { connectSessionId: string },
  parentOriginOverride?: string | null
) {
  const parentOrigin = parentOriginOverride || getPopupParentOrigin();
  const appUrl = (process.env.APP_URL || 'https://postolio.example').replace(/\/+$/, '');
  const fallbackUrl = `${appUrl}/brands`;
  const html = `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Connected - Postolio</title>
    </head>
    <body>
      <p>Connected. You can close this window.</p>
      <script>
        const parentOrigin = ${JSON.stringify(parentOrigin)};
        const fallbackUrl = ${JSON.stringify(fallbackUrl)};
        const payload = ${JSON.stringify(payload)};
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage({ type: 'META_OAUTH_SUCCESS', data: payload }, parentOrigin);
          }
        } catch (e) {}
        try { window.close(); } catch (e) {}
        setTimeout(() => { if (!window.closed) window.location.href = fallbackUrl; }, 150);
      </script>
    </body>
  </html>`;
  reply.type('text/html').send(html);
}

function sendMetaPopupErrorPage(
  reply: FastifyReply,
  payload: { error: string; errorDescription?: string },
  parentOriginOverride?: string | null
) {
  const parentOrigin = parentOriginOverride || getPopupParentOrigin();
  const appUrl = (process.env.APP_URL || 'https://postolio.example').replace(/\/+$/, '');
  const fallbackUrl = `${appUrl}/brands`;
  const html = `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Connection Error - Postolio</title>
    </head>
    <body>
      <p>Connection failed. You can close this window.</p>
      <script>
        const parentOrigin = ${JSON.stringify(parentOrigin)};
        const fallbackUrl = ${JSON.stringify(fallbackUrl)};
        const payload = ${JSON.stringify(payload)};
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage({ type: 'META_OAUTH_ERROR', data: payload }, parentOrigin);
          }
        } catch (e) {}
        try { window.close(); } catch (e) {}
        setTimeout(() => { if (!window.closed) window.location.href = fallbackUrl; }, 150);
      </script>
    </body>
  </html>`;
  reply.type('text/html').send(html);
}

function buildRedisKeys(connectSessionId: string, state?: string) {
  return {
    sessionKey: `meta:connect-session:${connectSessionId}`,
    candidatesKey: `meta:connect-candidates:${connectSessionId}`,
    tokensKey: `meta:connect-tokens:${connectSessionId}`,
    stateKey: state ? `meta:connect-state:${state}` : null,
  };
}

function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const origin = new URL(trimmed).origin;
    if (origin === 'null') return null;
    if (!/^https?:\/\//.test(origin)) return null;
    return origin;
  } catch {
    return null;
  }
}

async function loadConnectSessionByState(state: string): Promise<MetaConnectSession | null> {
  const key = buildRedisKeys('unused', state).stateKey!;
  const raw = await redisService.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MetaConnectSession;
  } catch {
    return null;
  }
}

async function exchangeCodeForAccessToken(code: string): Promise<{
  accessToken: string;
  expiresIn?: number;
}> {
  const url = fbGraph('oauth/access_token');
  const params = new URLSearchParams({
    client_id: FACEBOOK_APP_ID,
    client_secret: FACEBOOK_APP_SECRET,
    redirect_uri: META_REDIRECT_URI,
    code,
  });

  const response = await fetch(`${url}?${params.toString()}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Meta token exchange failed: ${redactOauthSensitiveDetails(text)}`);
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error('Meta token exchange did not return access_token');
  }

  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

async function exchangeForLongLivedToken(shortLivedToken: string): Promise<{
  accessToken: string;
  expiresIn?: number;
}> {
  const url = fbGraph('oauth/access_token');
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: FACEBOOK_APP_ID,
    client_secret: FACEBOOK_APP_SECRET,
    fb_exchange_token: shortLivedToken,
  });

  const response = await fetch(`${url}?${params.toString()}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Meta long-lived token exchange failed: ${redactOauthSensitiveDetails(text)}`);
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error('Meta long-lived token exchange did not return access_token');
  }

  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

async function listAllPages(userAccessToken: string): Promise<FacebookPage[]> {
  const pages: FacebookPage[] = [];
  let nextUrl: string | undefined = fbGraph(
    `me/accounts?fields=id,name,access_token,instagram_business_account,connected_instagram_account&limit=100&access_token=${encodeURIComponent(
      userAccessToken
    )}`
  );

  let fetches = 0;
  while (nextUrl && fetches < 20) {
    const response = await fetch(nextUrl);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Meta pages fetch failed: ${redactOauthSensitiveDetails(text)}`);
    }

    const data = (await response.json()) as PagesResponse;
    if (Array.isArray(data.data)) pages.push(...data.data);
    nextUrl = data.paging?.next;
    fetches += 1;
  }

  return pages;
}

async function fetchInstagramProfile(
  instagramAccountId: string,
  pageAccessToken: string
): Promise<InstagramProfile | null> {
  const url = fbGraph(
    `${instagramAccountId}?fields=id,username,name,biography,followers_count,media_count,profile_picture_url&access_token=${encodeURIComponent(
      pageAccessToken
    )}`
  );
  const response = await fetch(url);
  if (!response.ok) return null;
  return (await response.json()) as InstagramProfile;
}

const metaOAuthRoutes: FastifyPluginAsync = async function (fastify) {
  // GET /api/auth/meta/authorize?brandId=...
  fastify.get<{ Querystring: AuthorizeQuery }>(
    '/authorize',
    { preHandler: fastify.authenticate },
    async function (request, reply) {
      try {
        if (!ensureAuth(request, reply)) return;

        if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
          return reply.code(500).send({
            error: 'meta_config_missing',
            message: 'FACEBOOK_APP_ID/FACEBOOK_APP_SECRET must be set to use Meta connect',
          });
        }

        const { brandId } = request.query;
        if (!brandId) return reply.code(400).send({ error: 'brandId is required' });

        const userId = request.user.id;
        await assertBrandOwnership(userId, brandId);

        const connectSessionId = crypto.randomUUID();
        const state = crypto.randomBytes(32).toString('hex');
        const parentOrigin = normalizeOrigin(request.query.parentOrigin);

        const session: MetaConnectSession = {
          connectSessionId,
          userId,
          brandId,
          state,
          parentOrigin,
          createdAt: new Date().toISOString(),
        };

        const { sessionKey, stateKey } = buildRedisKeys(connectSessionId, state);

        const storedSession = await redisService.set(
          sessionKey,
          JSON.stringify(session),
          CONNECT_SESSION_TTL_SECONDS
        );
        const storedState = await redisService.set(
          stateKey!,
          JSON.stringify(session),
          CONNECT_SESSION_TTL_SECONDS
        );

        if (!storedSession || !storedState) {
          return reply.code(500).send({
            error: 'redis_unavailable',
            message: 'Redis is required to start the Meta connect flow',
          });
        }

        const scopes = [
          'pages_show_list',
          'pages_read_engagement',
          'pages_manage_posts',
          'business_management',
          'instagram_basic',
          'instagram_manage_insights',
          'instagram_content_publish',
        ].join(',');

        const authUrl =
          `https://www.facebook.com/${FB_GRAPH_API_VERSION}/dialog/oauth?` +
          `client_id=${encodeURIComponent(FACEBOOK_APP_ID)}&` +
          `redirect_uri=${encodeURIComponent(META_REDIRECT_URI)}&` +
          `scope=${encodeURIComponent(scopes)}&` +
          `state=${encodeURIComponent(state)}&` +
          `response_type=code&` +
          `display=popup`;

        return reply.send({ authUrl, connectSessionId });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        fastify.log.error({ message }, 'Meta OAuth authorize error');
        captureOauthException(error, {
          phase: 'authorize',
          correlationId: request.id,
          userId: (request as any)?.user?.id,
          brandId: request.query?.brandId,
        });
        return reply.code(500).send({ error: 'Failed to initiate Meta OAuth', message });
      }
    }
  );

  // GET /api/auth/meta/callback (OAuth redirect target)
  fastify.get<{ Querystring: CallbackQuery }>('/callback', async function (request, reply) {
    try {
      const { code, state, error, error_description } = request.query;

      if (error) {
        const description = error_description || error || 'Authorization failed';
        captureOauthMessage('Meta OAuth error returned by provider', {
          phase: 'callback',
          correlationId: request.id,
          error,
          errorDescription: description,
        });
        reply.code(400);
        return sendMetaPopupErrorPage(reply, { error, errorDescription: description });
      }

      if (!code || !state) {
        reply.code(400);
        return sendMetaPopupErrorPage(reply, {
          error: 'invalid_oauth_callback',
          errorDescription: 'Missing authorization parameters. Please try again.',
        });
      }

      const session = await loadConnectSessionByState(state);
      if (!session) {
        reply.code(400);
        return sendMetaPopupErrorPage(reply, {
          error: 'invalid_oauth_state',
          errorDescription: 'Invalid or expired authorization session. Please try again.',
        });
      }

      // Exchange code -> short-lived user token -> long-lived user token
      const shortLived = await exchangeCodeForAccessToken(code);
      const longLived = await exchangeForLongLivedToken(shortLived.accessToken);

      const tokenExpiresAt = new Date(
        Date.now() +
          (typeof longLived.expiresIn === 'number' ? longLived.expiresIn : 60 * 24 * 60 * 60) * 1000
      ).toISOString();

      // List pages + page tokens and derive candidates (Facebook Pages + connected Instagram accounts)
      const pages = await listAllPages(longLived.accessToken);

      if (!pages.length) {
        reply.code(400);
        return sendMetaPopupErrorPage(reply, {
          error: 'no_pages',
          errorDescription: 'No Facebook Pages were found for this Meta account.',
        });
      }

      const candidates: MetaConnectCandidate[] = [];
      const tokens: Record<string, MetaConnectCandidateToken> = {};

      for (const page of pages) {
        if (!page.id || !page.access_token) continue;

        const pageCandidateId = `facebook:${page.id}`;
        candidates.push({
          candidateId: pageCandidateId,
          platform: 'facebook',
          externalAccountId: page.id,
          externalPageId: page.id,
          displayName: page.name || null,
          username: null,
          profilePictureUrl: null,
          metadata: {
            pageId: page.id,
            pageName: page.name || null,
          },
        });
        tokens[pageCandidateId] = {
          accessToken: page.access_token,
          expiresAt: tokenExpiresAt,
          metadata: {
            pageId: page.id,
          },
        };

        const instagramAccountId =
          page.instagram_business_account?.id || page.connected_instagram_account?.id;
        if (!instagramAccountId) continue;

        const igProfile = await fetchInstagramProfile(instagramAccountId, page.access_token);
        const igCandidateId = `instagram:${instagramAccountId}`;

        candidates.push({
          candidateId: igCandidateId,
          platform: 'instagram',
          externalAccountId: instagramAccountId,
          externalPageId: page.id,
          username: igProfile?.username ? String(igProfile.username) : null,
          displayName: igProfile?.name ? String(igProfile.name) : null,
          profilePictureUrl: igProfile?.profile_picture_url
            ? String(igProfile.profile_picture_url)
            : null,
          metadata: {
            pageId: page.id,
            accountId: instagramAccountId,
            ...(igProfile ? { profileData: igProfile } : {}),
          },
        });

        tokens[igCandidateId] = {
          accessToken: page.access_token,
          expiresAt: tokenExpiresAt,
          metadata: {
            pageId: page.id,
            accountId: instagramAccountId,
          },
        };
      }

      const { candidatesKey, tokensKey, sessionKey, stateKey } = buildRedisKeys(
        session.connectSessionId,
        session.state
      );

      await redisService.set(
        candidatesKey,
        JSON.stringify({ candidates, expiresAt: tokenExpiresAt }),
        CONNECT_SESSION_TTL_SECONDS
      );
      await redisService.set(tokensKey, JSON.stringify(tokens), CONNECT_SESSION_TTL_SECONDS);

      // Refresh session TTLs after callback
      await redisService.set(sessionKey, JSON.stringify(session), CONNECT_SESSION_TTL_SECONDS);
      if (stateKey)
        await redisService.set(stateKey, JSON.stringify(session), CONNECT_SESSION_TTL_SECONDS);

      captureOauthMessage('Meta OAuth candidates generated', {
        phase: 'callback',
        correlationId: request.id,
        brandId: session.brandId,
        userId: session.userId,
        pagesCount: pages.length,
        candidatesCount: candidates.length,
      });

      return sendMetaPopupSuccessPage(
        reply,
        { connectSessionId: session.connectSessionId },
        session.parentOrigin
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      const safe = truncate(redactOauthSensitiveDetails(message), 2000);
      request.log.error({ err: safe }, 'Meta OAuth callback error');
      captureOauthException(error, {
        phase: 'callback',
        correlationId: request.id,
      });
      reply.code(500);
      return sendMetaPopupErrorPage(reply, {
        error: 'meta_oauth_failed',
        errorDescription: safe,
      });
    }
  });

  // GET /api/auth/meta/candidates?connectSessionId=...
  fastify.get<{ Querystring: CandidatesQuery }>(
    '/candidates',
    { preHandler: fastify.authenticate },
    async function (request, reply) {
      try {
        if (!ensureAuth(request, reply)) return;
        const { connectSessionId } = request.query;
        if (!connectSessionId)
          return reply.code(400).send({ error: 'connectSessionId is required' });

        const { sessionKey, candidatesKey } = buildRedisKeys(connectSessionId);
        const rawSession = await redisService.get(sessionKey);
        if (!rawSession) {
          return reply.code(404).send({ error: 'connect_session_not_found' });
        }

        const session = JSON.parse(rawSession) as MetaConnectSession;
        if (session.userId !== request.user.id) {
          return reply.code(403).send({ error: 'forbidden' });
        }

        await assertBrandOwnership(request.user.id, session.brandId);

        const rawCandidates = await redisService.get(candidatesKey);
        if (!rawCandidates) {
          return reply.code(404).send({ error: 'connect_candidates_not_found' });
        }

        const parsed = JSON.parse(rawCandidates) as {
          candidates: MetaConnectCandidate[];
          expiresAt?: string;
        };

        return reply.send({
          connectSessionId,
          brandId: session.brandId,
          expiresAt: parsed.expiresAt || null,
          candidates: parsed.candidates || [],
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        request.log.error({ err: message }, 'Failed to fetch Meta OAuth candidates');
        return reply.code(500).send({ error: 'failed_to_fetch_candidates', message });
      }
    }
  );

  // POST /api/auth/meta/finalize
  fastify.post<{ Body: FinalizeBody }>(
    '/finalize',
    { preHandler: fastify.authenticate },
    async function (request, reply) {
      try {
        if (!ensureAuth(request, reply)) return;

        const body = (request.body || {}) as FinalizeBody;
        const connectSessionId = body.connectSessionId;
        const candidateIds = Array.isArray(body.candidateIds) ? body.candidateIds : [];

        if (!connectSessionId)
          return reply.code(400).send({ error: 'connectSessionId is required' });
        if (!candidateIds.length)
          return reply.code(400).send({ error: 'candidateIds must not be empty' });

        const { sessionKey, candidatesKey, tokensKey } = buildRedisKeys(connectSessionId);
        const rawSession = await redisService.get(sessionKey);
        if (!rawSession) return reply.code(404).send({ error: 'connect_session_not_found' });
        const session = JSON.parse(rawSession) as MetaConnectSession;
        const stateKey = buildRedisKeys(connectSessionId, session.state).stateKey;

        if (session.userId !== request.user.id) {
          return reply.code(403).send({ error: 'forbidden' });
        }

        await assertBrandOwnership(request.user.id, session.brandId);

        const rawCandidates = await redisService.get(candidatesKey);
        const rawTokens = await redisService.get(tokensKey);
        if (!rawCandidates || !rawTokens) {
          return reply.code(404).send({ error: 'connect_session_expired' });
        }

        const parsedCandidates = JSON.parse(rawCandidates) as {
          candidates: MetaConnectCandidate[];
          expiresAt?: string;
        };
        const tokens = JSON.parse(rawTokens) as Record<string, MetaConnectCandidateToken>;

        const candidatesById = new Map(parsedCandidates.candidates.map((c) => [c.candidateId, c]));

        const selectedCandidates: MetaConnectCandidate[] = [];
        for (const id of candidateIds) {
          const candidate = candidatesById.get(id);
          if (!candidate) {
            return reply.code(400).send({ error: 'invalid_candidate', candidateId: id });
          }
          selectedCandidates.push(candidate);
        }

        const multiDestinationEnabled = isMultiDestinationEnabledForUser({
          userId: request.user.id,
          email: (request as any)?.user?.email ?? null,
        });

        if (!multiDestinationEnabled) {
          const nonInstagram = selectedCandidates.filter((c) => c.platform !== 'instagram');
          if (nonInstagram.length > 0) {
            return reply.code(403).send({
              error: 'feature_disabled',
              code: 'MULTI_DESTINATION_DISABLED',
              message: 'Only Instagram destinations are enabled for this account',
            });
          }

          if (selectedCandidates.length > 1) {
            return reply.code(400).send({
              error: 'too_many_destinations',
              code: 'MULTI_DESTINATION_DISABLED',
              message:
                'Only one Instagram account can be connected when multi-destination is disabled',
            });
          }

          const selectedInstagram = selectedCandidates[0] || null;
          if (selectedInstagram) {
            const existingInstagramAccounts = await prisma.socialAccount.findMany({
              where: { brandId: session.brandId, platform: 'instagram' as any },
              select: { id: true, externalAccountId: true, metadata: true },
            });

            const connectedInstagram = existingInstagramAccounts.filter(
              (account) => !isMetadataDisconnected(account.metadata)
            );

            if (connectedInstagram.length > 0) {
              const allowedExternalIds = new Set(
                connectedInstagram.map((account) => account.externalAccountId)
              );
              if (!allowedExternalIds.has(selectedInstagram.externalAccountId)) {
                return reply.code(403).send({
                  error: 'feature_disabled',
                  code: 'MULTI_DESTINATION_DISABLED',
                  message:
                    'Only one Instagram account can be connected when multi-destination is disabled',
                });
              }
            }
          }
        }

        // Prevent transferring accounts between brands (unique by platform+externalAccountId)
        const existing = await prisma.socialAccount.findMany({
          where: {
            OR: selectedCandidates.map((c) => ({
              platform: c.platform as any,
              externalAccountId: c.externalAccountId,
            })),
          },
          select: { id: true, brandId: true, platform: true, externalAccountId: true },
        });
        for (const row of existing) {
          if (row.brandId !== session.brandId) {
            return reply.code(409).send({
              error: 'account_already_connected',
              message: 'One or more selected accounts are already connected to another brand.',
              platform: row.platform,
              externalAccountId: row.externalAccountId,
            });
          }
        }

        const brand = await prisma.brand.findUnique({
          where: { id: session.brandId },
          select: { id: true, userId: true, preferences: true },
        });
        if (!brand) return reply.code(404).send({ error: 'brand_not_found' });

        const tokenClient = await getTokenService();

        const createdAccounts = await prisma.$transaction(async (tx) => {
          const nextSortOrder = await tx.socialAccount.aggregate({
            where: { brandId: session.brandId },
            _max: { sortOrder: true },
          });
          let sortOrder =
            typeof nextSortOrder._max.sortOrder === 'number' ? nextSortOrder._max.sortOrder : -1;

          const tokenUpdatedAt = new Date().toISOString();
          const upserts: Array<{
            socialAccountId: string;
            platform: MetaPlatform;
            candidate: MetaConnectCandidate;
          }> = [];

          for (const candidate of selectedCandidates) {
            const existingAccount = await tx.socialAccount.findUnique({
              where: {
                platform_externalAccountId: {
                  platform: candidate.platform as any,
                  externalAccountId: candidate.externalAccountId,
                },
              },
              select: { id: true, brandId: true },
            });

            const candidateMetadata = candidate.metadata
              ? (JSON.parse(JSON.stringify(candidate.metadata)) as Record<string, unknown>)
              : {};
            const token = tokens[candidate.candidateId];
            const tokenExpiresAt =
              token && typeof token.expiresAt === 'string' && token.expiresAt.trim()
                ? token.expiresAt
                : parsedCandidates.expiresAt || null;
            const mergedMetadata: Record<string, unknown> = {
              ...candidateMetadata,
              ...(tokenExpiresAt ? { tokenExpiresAt } : {}),
              tokenUpdatedAt,
            };
            const metadata = JSON.parse(JSON.stringify(mergedMetadata)) as Prisma.InputJsonValue;

            if (!existingAccount) {
              sortOrder += 1;
              const created = await tx.socialAccount.create({
                data: {
                  brandId: session.brandId,
                  platform: candidate.platform as any,
                  externalAccountId: candidate.externalAccountId,
                  externalPageId: candidate.externalPageId || null,
                  username: candidate.username || null,
                  displayName: candidate.displayName || null,
                  metadata,
                  sortOrder,
                },
                select: { id: true },
              });
              upserts.push({
                socialAccountId: created.id,
                platform: candidate.platform,
                candidate,
              });
              continue;
            }

            if (existingAccount.brandId !== session.brandId) {
              throw new Error('Account already connected to another brand');
            }

            const updated = await tx.socialAccount.update({
              where: { id: existingAccount.id },
              data: {
                externalPageId: candidate.externalPageId || null,
                username: candidate.username || null,
                displayName: candidate.displayName || null,
                metadata,
              },
              select: { id: true },
            });
            upserts.push({ socialAccountId: updated.id, platform: candidate.platform, candidate });
          }

          const ensured = new Set<string>();
          for (const item of upserts) {
            if (ensured.has(item.socialAccountId)) continue;
            ensured.add(item.socialAccountId);
            await ensureDefaultQueueWithStarterSchedule(tx, item.socialAccountId);
          }

          return upserts;
        });

        // Store tokens in Token Service AFTER DB commit
        for (const item of createdAccounts) {
          const token = tokens[item.candidate.candidateId];
          if (!token?.accessToken) continue;

          await tokenClient.storeTokenForSocialAccount({
            userId: brand.userId,
            brandId: brand.id,
            platform: item.platform,
            socialAccountId: item.socialAccountId,
            accessToken: token.accessToken,
            expiresAt: new Date(token.expiresAt),
            metadata: token.metadata,
          });
        }

        // Invalidate publisher credentials cache after token updates
        try {
          await PublisherCredentialsService.invalidateCredentialsCache(brand.id);
        } catch {
          // best-effort
        }

        // Cleanup connect session material
        await redisService.del(candidatesKey);
        await redisService.del(tokensKey);
        await redisService.del(sessionKey);
        if (stateKey) await redisService.del(stateKey);

        const socialAccounts = await prisma.socialAccount.findMany({
          where: { brandId: session.brandId },
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

        return reply.send({
          success: true,
          brandId: session.brandId,
          connected: createdAccounts.map((a) => ({
            socialAccountId: a.socialAccountId,
            platform: a.platform,
          })),
          socialAccounts,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        request.log.error({ err: message }, 'Meta connect finalize failed');
        captureOauthException(error, {
          phase: 'finalize',
          correlationId: request.id,
          userId: (request as any)?.user?.id,
        });
        return reply.code(500).send({ error: 'finalize_failed', message });
      }
    }
  );
};

export default metaOAuthRoutes;
