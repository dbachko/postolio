import type { FastifyInstance } from 'fastify';

import {
  buildRedisKeys,
  captureOauthException,
  captureOauthMessage,
  CONNECT_SESSION_TTL_SECONDS,
  exchangeCodeForAccessToken,
  exchangeForLongLivedToken,
  fetchInstagramProfile,
  listAllPages,
  loadConnectSessionByState,
  redactOauthSensitiveDetails,
  sendMetaPopupErrorPage,
  sendMetaPopupSuccessPage,
  type CallbackQuery,
  type MetaConnectCandidate,
  type MetaConnectCandidateToken,
  type MetaConnectSession,
  redisService,
  truncate,
} from './shared.js';

function computeTokenExpiresAt(expiresIn?: number) {
  const ttlSeconds = typeof expiresIn === 'number' ? expiresIn : 60 * 24 * 60 * 60;
  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

async function buildCandidatesAndTokens(params: {
  pages: Array<{
    id: string;
    name?: string;
    access_token?: string;
    instagram_business_account?: { id: string };
    connected_instagram_account?: { id: string };
  }>;
  tokenExpiresAt: string;
}) {
  const candidates: MetaConnectCandidate[] = [];
  const tokens: Record<string, MetaConnectCandidateToken> = {};

  for (const page of params.pages) {
    if (!page.id || !page.access_token) {
      continue;
    }

    const pageCandidateId = `facebook:${page.id}`;
    candidates.push({
      candidateId: pageCandidateId,
      platform: 'facebook',
      externalAccountId: page.id,
      externalPageId: page.id,
      displayName: page.name || null,
      username: null,
      profilePictureUrl: null,
      metadata: { pageId: page.id, pageName: page.name || null },
    });
    tokens[pageCandidateId] = {
      accessToken: page.access_token,
      expiresAt: params.tokenExpiresAt,
      metadata: { pageId: page.id },
    };

    const instagramAccountId =
      page.instagram_business_account?.id || page.connected_instagram_account?.id;
    if (!instagramAccountId) {
      continue;
    }

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
      expiresAt: params.tokenExpiresAt,
      metadata: { pageId: page.id, accountId: instagramAccountId },
    };
  }

  return { candidates, tokens };
}

async function persistCallbackArtifacts(params: {
  session: MetaConnectSession;
  candidates: MetaConnectCandidate[];
  tokens: Record<string, MetaConnectCandidateToken>;
  tokenExpiresAt: string;
}) {
  const { candidatesKey, tokensKey, sessionKey, stateKey } = buildRedisKeys(
    params.session.connectSessionId,
    params.session.state
  );
  await redisService.set(
    candidatesKey,
    JSON.stringify({ candidates: params.candidates, expiresAt: params.tokenExpiresAt }),
    CONNECT_SESSION_TTL_SECONDS
  );
  await redisService.set(tokensKey, JSON.stringify(params.tokens), CONNECT_SESSION_TTL_SECONDS);
  await redisService.set(sessionKey, JSON.stringify(params.session), CONNECT_SESSION_TTL_SECONDS);
  if (stateKey) {
    await redisService.set(stateKey, JSON.stringify(params.session), CONNECT_SESSION_TTL_SECONDS);
  }
}

function createCallbackHandler() {
  return async (request: any, reply: any) => {
    try {
      const { code, state, error, error_description } = request.query as CallbackQuery;
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

      const shortLived = await exchangeCodeForAccessToken(code);
      const longLived = await exchangeForLongLivedToken(shortLived.accessToken);
      const tokenExpiresAt = computeTokenExpiresAt(longLived.expiresIn);
      const pages = await listAllPages(longLived.accessToken);
      if (!pages.length) {
        reply.code(400);
        return sendMetaPopupErrorPage(reply, {
          error: 'no_pages',
          errorDescription: 'No Facebook Pages were found for this Meta account.',
        });
      }

      const { candidates, tokens } = await buildCandidatesAndTokens({ pages, tokenExpiresAt });
      await persistCallbackArtifacts({ session, candidates, tokens, tokenExpiresAt });
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
      captureOauthException(error, { phase: 'callback', correlationId: request.id });
      reply.code(500);
      return sendMetaPopupErrorPage(reply, {
        error: 'meta_oauth_failed',
        errorDescription: safe,
      });
    }
  };
}

export function registerMetaCallbackRoute(fastify: FastifyInstance) {
  fastify.get<{ Querystring: CallbackQuery }>('/callback', createCallbackHandler());
}
