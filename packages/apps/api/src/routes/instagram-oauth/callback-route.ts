import type { FastifyInstance, FastifyReply } from 'fastify';

import { PublisherCredentialsService } from '../../services/publisher-credentials.js';
import { sendErrorPage } from '../../utils/oauth-error-pages.js';
import { sendSuccessPage } from '../../utils/oauth-success-page.js';
import {
  exchangeAuthorizationCode,
  fetchInstagramProfile,
  fetchPagesAndFindInstagram,
  getBrandPreferences,
  getGraphHelpers,
  hasExpiredOauthState,
  hydratePageFromDetails,
  parseCallbackParams,
} from './callback-facebook.js';
import {
  persistConnectedAccount,
  triggerBrandAnalysis,
  triggerInitialSync,
} from './callback-post-connect.js';
import {
  FB_OAUTH_DEBUG_ENABLED,
  captureOauthException,
  captureOauthMessage,
  prisma,
  tokenServiceClient,
  type CallbackQuery,
} from './shared.js';

function sendCallbackError(reply: FastifyReply, error: string, errorDescription: string) {
  reply.code(400);
  sendErrorPage(reply, { error, errorDescription, retryUrl: '/brands' });
}

function handleProviderError(
  query: CallbackQuery,
  requestId: string,
  reply: FastifyReply
): boolean {
  if (!query.error) {
    return false;
  }

  const providerError = query.error;
  const providerErrorDescription =
    query.error_description || providerError || 'Authorization failed';
  if (!['access_denied', 'user_denied'].includes(providerError)) {
    captureOauthMessage('Instagram OAuth error returned by provider', {
      phase: 'callback',
      correlationId: requestId,
      error: providerError,
      errorDescription: providerErrorDescription,
    });
  }

  sendCallbackError(reply, providerError, providerErrorDescription);
  return true;
}

async function resolveBrandContext(request: { query: CallbackQuery }, reply: FastifyReply) {
  const callbackParams = parseCallbackParams(request.query);
  if (!callbackParams) {
    sendCallbackError(
      reply,
      'invalid_state',
      'Missing authorization parameters. Please try connecting again.'
    );
    return null;
  }

  const brand = await prisma.brand.findFirst({
    where: { preferences: { path: ['oauthState'], equals: callbackParams.state } },
  });
  if (!brand) {
    sendCallbackError(
      reply,
      'invalid_oauth_state',
      'Invalid or expired authorization session. Please try connecting again.'
    );
    return null;
  }

  const preferences = getBrandPreferences(brand);
  if (hasExpiredOauthState(preferences)) {
    sendCallbackError(
      reply,
      'invalid_oauth_state',
      'Your authorization session has expired. Please try connecting again.'
    );
    return null;
  }

  return { code: callbackParams.code, brand, preferences };
}

async function resolveConnectionContext(params: {
  fastify: FastifyInstance;
  requestId: string;
  code: string;
  brand: any;
  reply: FastifyReply;
}) {
  const graph = getGraphHelpers(params.fastify);
  const tokenData = await exchangeAuthorizationCode({
    code: params.code,
    brand: params.brand,
    requestId: params.requestId,
    fbGraph: graph.fbGraph,
    fbGraphApiVersion: graph.version,
  });
  if (!tokenData?.access_token) {
    sendCallbackError(
      params.reply,
      'token_exchange_failed',
      'Failed to exchange authorization token. Please try again.'
    );
    return null;
  }

  const pageResult = await fetchPagesAndFindInstagram({
    accessToken: tokenData.access_token,
    brand: params.brand,
    requestId: params.requestId,
    fbGraph: graph.fbGraph,
    fbGraphApiVersion: graph.version,
    logDebug: graph.logDebug,
  }).catch((error) => {
    sendCallbackError(
      params.reply,
      'default',
      error instanceof Error ? error.message : 'Failed to get pages'
    );
    return null;
  });
  if (!pageResult) {
    return null;
  }

  const pageWithInstagram =
    pageResult.pageWithInstagram ||
    (await hydratePageFromDetails({
      pages: pageResult.pages,
      fbGraph: graph.fbGraph,
      logDebug: graph.logDebug,
    }));

  if (!pageWithInstagram) {
    captureOauthMessage('Instagram OAuth no connected Instagram account found', {
      phase: 'pages_scan',
      correlationId: params.requestId,
      brandId: params.brand.id,
      userId: params.brand.userId,
      pagesCount: pageResult.pages.length,
      pages: FB_OAUTH_DEBUG_ENABLED ? pageResult.pages : undefined,
    });

    sendCallbackError(
      params.reply,
      'no_business_account',
      'No Instagram Business or Creator account was found connected to your Facebook pages.'
    );
    return null;
  }

  const instagramAccountId =
    pageWithInstagram.instagram_business_account?.id ||
    pageWithInstagram.connected_instagram_account?.id;
  const pageAccessToken = pageWithInstagram.access_token;
  if (!instagramAccountId || !pageAccessToken) {
    sendCallbackError(
      params.reply,
      'default',
      'Incomplete account data returned from Facebook. Please try again.'
    );
    return null;
  }

  const instagramProfile = await fetchInstagramProfile({
    instagramAccountId,
    pageAccessToken,
    pageWithInstagram,
    brand: params.brand,
    requestId: params.requestId,
    fbGraph: graph.fbGraph,
    fbGraphApiVersion: graph.version,
  });
  if (!instagramProfile) {
    sendCallbackError(
      params.reply,
      'default',
      'Failed to fetch Instagram profile. Please try again.'
    );
    return null;
  }

  instagramProfile.account_type = pageWithInstagram.instagram_business_account
    ? 'BUSINESS'
    : 'CREATOR';
  return { tokenData, pageWithInstagram, instagramAccountId, pageAccessToken, instagramProfile };
}

async function processInstagramOAuthCallback(
  fastify: FastifyInstance,
  request: { id: string; query: CallbackQuery },
  reply: FastifyReply
) {
  if (handleProviderError(request.query, request.id, reply)) {
    return;
  }

  const brandContext = await resolveBrandContext(request, reply);
  if (!brandContext) {
    return;
  }

  const connectionContext = await resolveConnectionContext({
    fastify,
    requestId: request.id,
    code: brandContext.code,
    brand: brandContext.brand,
    reply,
  });
  if (!connectionContext) {
    return;
  }

  const tokenExpiresAt = connectionContext.tokenData.expires_in
    ? new Date(Date.now() + connectionContext.tokenData.expires_in * 1000)
    : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

  const { updatedBrand, connectedSocialAccount } = await persistConnectedAccount({
    brand: brandContext.brand,
    preferences: brandContext.preferences,
    instagramAccountId: connectionContext.instagramAccountId,
    pageWithInstagram: connectionContext.pageWithInstagram,
    instagramProfile: connectionContext.instagramProfile,
    tokenExpiresAt,
  });

  await tokenServiceClient.storeTokenForSocialAccount({
    userId: brandContext.brand.userId,
    brandId: brandContext.brand.id,
    platform: 'instagram',
    socialAccountId: connectedSocialAccount.id,
    accessToken: connectionContext.pageAccessToken,
    expiresAt: tokenExpiresAt,
    metadata: {
      pageId: connectionContext.pageWithInstagram.id,
      accountId: connectionContext.instagramAccountId,
      profileData: connectionContext.instagramProfile,
    },
  });

  await PublisherCredentialsService.invalidateCredentialsCache(brandContext.brand.id);
  triggerInitialSync(updatedBrand.id);
  triggerBrandAnalysis(fastify, { brandId: updatedBrand.id, userId: brandContext.brand.userId });

  sendSuccessPage(reply, {
    profile: {
      id: connectionContext.instagramProfile.id,
      username: connectionContext.instagramProfile.username,
      name: connectionContext.instagramProfile.name,
      biography: connectionContext.instagramProfile.biography,
      followers_count: connectionContext.instagramProfile.followers_count,
      media_count: connectionContext.instagramProfile.media_count,
      profile_picture_url: connectionContext.instagramProfile.profile_picture_url,
      account_type: connectionContext.instagramProfile.account_type,
    },
    brandName: updatedBrand.name,
  });
}

export function registerInstagramOAuthCallbackRoute(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: CallbackQuery }>('/callback', async (request, reply) => {
    try {
      await processInstagramOAuthCallback(fastify, request, reply);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      fastify.log.error({ message }, 'OAuth callback error:');
      captureOauthException(error, { phase: 'callback', correlationId: request.id });
      reply.code(500);
      sendErrorPage(reply, {
        error: 'default',
        errorDescription: 'Failed to process Instagram connection. Please try again.',
        technicalDetails: message,
        retryUrl: '/brands',
      });
    }
  });
}
