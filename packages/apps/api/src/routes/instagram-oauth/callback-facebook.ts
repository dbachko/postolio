import type { FastifyInstance } from 'fastify';

import {
  FACEBOOK_APP_ID,
  FACEBOOK_APP_SECRET,
  REDIRECT_URI,
  FB_OAUTH_DEBUG_ENABLED,
  captureOauthMessage,
  classifyFacebookGraphError,
  parseFacebookGraphError,
  redactOauthSensitiveDetails,
  summarizeFacebookPages,
  truncate,
  type CallbackQuery,
  type FacebookPage,
  type InstagramProfile,
  type PagesResponse,
} from './shared.js';

export function parseCallbackParams(query: CallbackQuery) {
  const { code, state } = query;
  if (!code || !state) {
    return null;
  }
  return { code, state };
}

export function getBrandPreferences(brand: any): Record<string, unknown> {
  return typeof brand.preferences === 'object' && brand.preferences
    ? (brand.preferences as Record<string, unknown>)
    : {};
}

export function hasExpiredOauthState(preferences: Record<string, unknown>): boolean {
  const expiresRaw = preferences.oauthStateExpires;
  return typeof expiresRaw === 'string' && new Date(expiresRaw) < new Date();
}

export function getGraphHelpers(fastify: FastifyInstance) {
  const version = process.env.FB_GRAPH_API_VERSION || 'v24.0';
  const fbGraph = (path: string) => `https://graph.facebook.com/${version}/${path}`;
  const logDebug = (message: string, context: Record<string, unknown> = {}) => {
    if (!FB_OAUTH_DEBUG_ENABLED) {
      return;
    }
    fastify.log.info({ debug: 'facebook-oauth', fbGraphApiVersion: version, ...context }, message);
  };

  return { version, fbGraph, logDebug };
}

export async function exchangeAuthorizationCode(params: {
  code: string;
  brand: any;
  requestId: string;
  fbGraph: (path: string) => string;
  fbGraphApiVersion: string;
}): Promise<{ access_token: string; expires_in?: number } | null> {
  const tokenExchangeUrl = params.fbGraph('oauth/access_token');
  const tokenParams = new URLSearchParams({
    client_id: FACEBOOK_APP_ID,
    client_secret: FACEBOOK_APP_SECRET,
    redirect_uri: REDIRECT_URI,
    code: params.code,
  });

  const tokenResponse = await fetch(`${tokenExchangeUrl}?${tokenParams}`, { method: 'GET' });
  if (tokenResponse.ok) {
    return (await tokenResponse.json()) as { access_token: string; expires_in?: number };
  }

  const errorText = await tokenResponse.text();
  const graphError = parseFacebookGraphError(errorText);
  const classified = classifyFacebookGraphError(graphError, errorText);
  captureOauthMessage('Instagram OAuth token exchange failed', {
    phase: 'token_exchange',
    correlationId: params.requestId,
    brandId: params.brand.id,
    userId: params.brand.userId,
    fbGraphApiVersion: params.fbGraphApiVersion,
    httpStatus: tokenResponse.status,
    classifiedError: classified.code,
    facebookErrorCode: graphError?.code,
    facebookErrorSubcode: graphError?.error_subcode,
    facebookTraceId: graphError?.fbtrace_id,
    responseBody: truncate(redactOauthSensitiveDetails(errorText), 2000),
  });

  return null;
}

export async function fetchPagesAndFindInstagram(params: {
  accessToken: string;
  brand: any;
  requestId: string;
  fbGraph: (path: string) => string;
  fbGraphApiVersion: string;
  logDebug: (message: string, context?: Record<string, unknown>) => void;
}): Promise<{ pages: FacebookPage[]; pageWithInstagram: FacebookPage | null }> {
  let nextPagesUrl: string | undefined = params.fbGraph(
    `me/accounts?access_token=${params.accessToken}&fields=id,name,access_token,instagram_business_account,connected_instagram_account&limit=100`
  );

  const pages: FacebookPage[] = [];
  let pageWithInstagram: FacebookPage | null = null;
  let pageFetches = 0;

  while (nextPagesUrl && !pageWithInstagram && pageFetches < 10) {
    const pagesResponse = await fetch(nextPagesUrl);
    if (!pagesResponse.ok) {
      const errorText = await pagesResponse.text();
      const graphError = parseFacebookGraphError(errorText);
      const classified = classifyFacebookGraphError(graphError, errorText);
      captureOauthMessage('Instagram OAuth failed to fetch Facebook pages', {
        phase: 'pages_fetch',
        correlationId: params.requestId,
        brandId: params.brand.id,
        userId: params.brand.userId,
        fbGraphApiVersion: params.fbGraphApiVersion,
        httpStatus: pagesResponse.status,
        classifiedError: classified.code,
        facebookErrorCode: graphError?.code,
        facebookErrorSubcode: graphError?.error_subcode,
        facebookTraceId: graphError?.fbtrace_id,
        responseBody: truncate(redactOauthSensitiveDetails(errorText), 2000),
      });
      throw new Error(classified.description || redactOauthSensitiveDetails(errorText));
    }

    const pagesData = (await pagesResponse.json()) as PagesResponse;
    if (Array.isArray(pagesData.data) && pagesData.data.length > 0) {
      pages.push(...pagesData.data);
      pageWithInstagram =
        pagesData.data.find(
          (page) => page.instagram_business_account || page.connected_instagram_account
        ) || null;
    }

    params.logDebug('Fetched Facebook pages page', {
      fetchIndex: pageFetches,
      returnedCount: Array.isArray(pagesData.data) ? pagesData.data.length : 0,
      aggregatedCount: pages.length,
      hasPagingNext: !!pagesData.paging?.next,
      pages: summarizeFacebookPages(pagesData.data || []),
    });

    nextPagesUrl = pagesData.paging?.next;
    pageFetches += 1;
  }

  return { pages, pageWithInstagram };
}

export async function hydratePageFromDetails(params: {
  pages: FacebookPage[];
  fbGraph: (path: string) => string;
  logDebug: (message: string, context?: Record<string, unknown>) => void;
}): Promise<FacebookPage | null> {
  for (const page of params.pages) {
    if (!page.access_token) {
      continue;
    }

    const pageDetailsUrl = params.fbGraph(
      `${page.id}?fields=instagram_business_account,connected_instagram_account&access_token=${page.access_token}`
    );
    const pageDetailsResponse = await fetch(pageDetailsUrl);
    if (!pageDetailsResponse.ok) {
      continue;
    }

    const pageDetails = (await pageDetailsResponse.json()) as Pick<
      FacebookPage,
      'instagram_business_account' | 'connected_instagram_account'
    >;

    params.logDebug('Fetched Facebook page details', {
      pageId: page.id,
      pageName: page.name || null,
      instagramBusinessAccountId: pageDetails.instagram_business_account?.id || null,
      connectedInstagramAccountId: pageDetails.connected_instagram_account?.id || null,
    });

    if (pageDetails.instagram_business_account || pageDetails.connected_instagram_account) {
      return { ...page, ...pageDetails };
    }
  }

  return null;
}

export async function fetchInstagramProfile(params: {
  instagramAccountId: string;
  pageAccessToken: string;
  pageWithInstagram: FacebookPage;
  brand: any;
  requestId: string;
  fbGraph: (path: string) => string;
  fbGraphApiVersion: string;
}): Promise<InstagramProfile | null> {
  const instagramUrl = params.fbGraph(
    `${params.instagramAccountId}?fields=id,username,name,biography,followers_count,media_count,profile_picture_url&access_token=${params.pageAccessToken}`
  );
  const instagramResponse = await fetch(instagramUrl);
  if (instagramResponse.ok) {
    return (await instagramResponse.json()) as InstagramProfile;
  }

  const errorText = await instagramResponse.text();
  const graphError = parseFacebookGraphError(errorText);
  const classified = classifyFacebookGraphError(graphError, errorText);
  captureOauthMessage('Instagram OAuth failed to fetch Instagram profile', {
    phase: 'instagram_profile_fetch',
    correlationId: params.requestId,
    brandId: params.brand.id,
    userId: params.brand.userId,
    fbGraphApiVersion: params.fbGraphApiVersion,
    instagramAccountId: params.instagramAccountId,
    pageId: params.pageWithInstagram.id,
    httpStatus: instagramResponse.status,
    classifiedError: classified.code,
    facebookErrorCode: graphError?.code,
    facebookErrorSubcode: graphError?.error_subcode,
    facebookTraceId: graphError?.fbtrace_id,
    responseBody: truncate(redactOauthSensitiveDetails(errorText), 2000),
  });

  return null;
}
