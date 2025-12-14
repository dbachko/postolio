import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { EventBridge, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import crypto from 'crypto';
import { captureException, captureMessage } from '@postolio/observability';

import { getDatabaseClient } from '../config/database.js';
import { PublisherCredentialsService } from '../services/publisher-credentials.js';
import { TokenServiceClient } from '../clients/token-service-client.js';
import { instagramService } from '../services/instagram.js';
import { importImageFromExternalUrl } from '../services/assets-media.js';
import { buildAnalysisAssetMetadata } from '../services/brand-analysis-assets.js';
import { redisService } from '../services/redis.js';
import { assertBrandOwnership } from '../services/ownership.js';
import { sendErrorPage } from '../utils/oauth-error-pages.js';
import { sendSuccessPage } from '../utils/oauth-success-page.js';

const prisma = getDatabaseClient();
const tokenServiceClient = new TokenServiceClient();
const eventBridge = new EventBridge({});
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'default';

interface AuthorizeQuery {
  brandId: string;
  redirectUri?: string;
}

interface CallbackQuery {
  code: string;
  state: string;
  error?: string;
  error_description?: string;
}

// Environment variables for Meta App
const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || 'test_app_id';
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || 'test_app_secret';
const REDIRECT_URI =
  process.env.INSTAGRAM_REDIRECT_URI || 'http://localhost:3000/api/auth/instagram/callback';

const FB_OAUTH_DEBUG_ENABLED = (process.env.FB_OAUTH_DEBUG || '').toLowerCase() === 'true';

// Auth guard leveraging fastify.authenticate decorator
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

interface FacebookPage {
  id: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: { id: string };
  connected_instagram_account?: { id: string };
}

interface PagesResponse {
  data?: FacebookPage[];
  paging?: {
    next?: string;
  };
}

interface InstagramProfile extends Record<string, unknown> {
  id?: string;
  username?: string;
  name?: string;
  biography?: string;
  followers_count?: number;
  media_count?: number;
  profile_picture_url?: string;
  account_type?: string;
}

function summarizeFacebookPages(pages: FacebookPage[]) {
  const maxPages = 50;
  const items = pages.slice(0, maxPages).map((page) => ({
    id: page.id,
    name: page.name,
    hasAccessToken: !!page.access_token,
    instagramBusinessAccountId: page.instagram_business_account?.id || null,
    connectedInstagramAccountId: page.connected_instagram_account?.id || null,
  }));

  return {
    count: pages.length,
    items,
    truncated: pages.length > maxPages,
  };
}

interface ParsedFacebookGraphError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
  error_user_title?: string;
  error_user_msg?: string;
  is_transient?: boolean;
}

function redactOauthSensitiveDetails(value: string): string {
  return String(value || '')
    .replace(/access_token=[^&\s"]+/gi, 'access_token=[REDACTED]')
    .replace(/client_secret=[^&\s"]+/gi, 'client_secret=[REDACTED]');
}

function parseFacebookGraphError(raw: string): ParsedFacebookGraphError | null {
  try {
    const parsed = JSON.parse(raw) as { error?: ParsedFacebookGraphError };
    if (!parsed?.error || typeof parsed.error !== 'object') return null;
    return parsed.error;
  } catch {
    return null;
  }
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}…`;
}

function captureOauthMessage(message: string, context: Record<string, unknown>) {
  captureMessage(message, { module: 'instagram-oauth', ...context });
}

function captureOauthException(error: unknown, context: Record<string, unknown>) {
  captureException(error, { module: 'instagram-oauth', ...context });
}

function classifyFacebookGraphError(err: ParsedFacebookGraphError | null, fallback: string) {
  const description =
    err?.error_user_msg || err?.message || redactOauthSensitiveDetails(fallback) || 'Unknown error';

  const messageLower = description.toLowerCase();
  const code = err?.code;

  if (
    code === 10 ||
    code === 200 ||
    messageLower.includes('permission') ||
    messageLower.includes('permissions')
  ) {
    return { code: 'missing_permissions', description };
  }

  if (
    code === 4 ||
    code === 17 ||
    code === 32 ||
    code === 613 ||
    messageLower.includes('rate limit') ||
    messageLower.includes('too many')
  ) {
    return { code: 'rate_limited', description };
  }

  if (messageLower.includes('restricted') || messageLower.includes('violation')) {
    return { code: 'account_restricted', description };
  }

  return { code: 'default', description };
}

const instagramOAuthRoutes: FastifyPluginAsync = async function (fastify) {
  // Initiate Instagram OAuth authorization
  fastify.get<{ Querystring: AuthorizeQuery }>(
    '/authorize',
    { preHandler: fastify.authenticate },
    async function (request, reply) {
      try {
        if (!ensureAuth(request, reply)) return;

        const { brandId } = request.query;

        if (!brandId) {
          return reply.status(400).send({ error: 'brandId is required' });
        }

        const userId = request.user.id;

        // Verify brand belongs to user
        const brand = await assertBrandOwnership(userId, brandId);

        // Generate secure state parameter
        const state = crypto.randomBytes(32).toString('hex');

        // Store state in database temporarily (expires in 10 minutes)
        await prisma.brand.update({
          where: { id: brandId },
          data: {
            preferences: {
              ...(typeof brand.preferences === 'object' && brand.preferences
                ? brand.preferences
                : {}),
              oauthState: state,
              oauthStateExpires: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            },
          },
        });

        // Build Facebook OAuth URL for Instagram Graph API permissions
        // Note: Instagram Graph API uses Pages API permissions
        const scopes = [
          'pages_show_list',
          'pages_read_engagement',
          'pages_manage_posts',
          'business_management',
          'instagram_basic',
          'instagram_content_publish',
        ].join(',');

        const authUrl =
          `https://www.facebook.com/dialog/oauth?` +
          `client_id=${FACEBOOK_APP_ID}&` +
          `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
          `scope=${encodeURIComponent(scopes)}&` +
          `state=${state}&` +
          `response_type=code`;

        reply.send({
          authUrl,
          state,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        fastify.log.error({ message }, 'OAuth authorization error:');
        captureOauthException(error, {
          phase: 'authorize',
          correlationId: request.id,
          userId: (request as any)?.user?.id,
          brandId: request.query?.brandId,
        });
        reply.status(500).send({
          error: 'Failed to initiate OAuth authorization',
          message,
        });
      }
    }
  );

  // Handle OAuth callback
  fastify.get<{ Querystring: CallbackQuery }>('/callback', async function (request, reply) {
    try {
      // Handle OAuth errors first
      if (request.query.error) {
        const providerError = request.query.error;
        const providerErrorDescription =
          request.query.error_description || request.query.error || 'Authorization failed';
        if (!['access_denied', 'user_denied'].includes(providerError)) {
          captureOauthMessage('Instagram OAuth error returned by provider', {
            phase: 'callback',
            correlationId: request.id,
            error: providerError,
            errorDescription: providerErrorDescription,
          });
        }
        reply.code(400);
        sendErrorPage(reply, {
          error: providerError,
          errorDescription: providerErrorDescription || 'An error occurred during authorization',
          retryUrl: '/brands',
        });
        return;
      }

      const { code, state } = request.query;

      if (!code || !state) {
        reply.code(400);
        sendErrorPage(reply, {
          error: 'invalid_state',
          errorDescription: 'Missing authorization parameters. Please try connecting again.',
          retryUrl: '/brands',
        });
        return;
      }

      // Find brand with matching OAuth state (no auth required - state provides security)
      const brand = await prisma.brand.findFirst({
        where: {
          preferences: {
            path: ['oauthState'],
            equals: state,
          },
        },
      });

      if (!brand) {
        reply.code(400);
        sendErrorPage(reply, {
          error: 'invalid_oauth_state',
          errorDescription:
            'Invalid or expired authorization session. Please try connecting again.',
          retryUrl: '/brands',
        });
        return;
      }

      const preferences: Record<string, unknown> =
        typeof brand.preferences === 'object' && brand.preferences
          ? (brand.preferences as Record<string, unknown>)
          : {};

      // Check if state has expired
      const expiresRaw = preferences?.oauthStateExpires;
      if (typeof expiresRaw === 'string' && new Date(expiresRaw) < new Date()) {
        reply.code(400);
        sendErrorPage(reply, {
          error: 'invalid_oauth_state',
          errorDescription: 'Your authorization session has expired. Please try connecting again.',
          retryUrl: '/brands',
        });
        return;
      }

      // Centralize Facebook Graph API version for OAuth
      const FB_GRAPH_API_VERSION = process.env.FB_GRAPH_API_VERSION || 'v24.0';
      const fbGraph = (path: string) =>
        `https://graph.facebook.com/${FB_GRAPH_API_VERSION}/${path}`;

      const logFacebookOauthDebug = (message: string, context: Record<string, unknown> = {}) => {
        if (!FB_OAUTH_DEBUG_ENABLED) return;
        fastify.log.info(
          {
            debug: 'facebook-oauth',
            fbGraphApiVersion: FB_GRAPH_API_VERSION,
            ...context,
          },
          message
        );
      };

      // Exchange authorization code for access token
      const tokenExchangeUrl = fbGraph('oauth/access_token');
      const tokenParams = new URLSearchParams({
        client_id: FACEBOOK_APP_ID,
        client_secret: FACEBOOK_APP_SECRET,
        redirect_uri: REDIRECT_URI,
        code: code,
      });

      const tokenResponse = await fetch(`${tokenExchangeUrl}?${tokenParams}`, {
        method: 'GET',
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        const graphError = parseFacebookGraphError(errorText);
        const classified = classifyFacebookGraphError(graphError, errorText);
        captureOauthMessage('Instagram OAuth token exchange failed', {
          phase: 'token_exchange',
          correlationId: request.id,
          brandId: brand.id,
          userId: brand.userId,
          fbGraphApiVersion: FB_GRAPH_API_VERSION,
          httpStatus: tokenResponse.status,
          classifiedError: classified.code,
          facebookErrorCode: graphError?.code,
          facebookErrorSubcode: graphError?.error_subcode,
          facebookTraceId: graphError?.fbtrace_id,
          responseBody: truncate(redactOauthSensitiveDetails(errorText), 2000),
        });
        fastify.log.error(
          { err: redactOauthSensitiveDetails(errorText) },
          'Token exchange failed:'
        );
        reply.code(400);
        sendErrorPage(reply, {
          error: classified.code === 'default' ? 'token_exchange_failed' : classified.code,
          errorDescription: classified.description,
          technicalDetails: redactOauthSensitiveDetails(errorText),
          retryUrl: '/brands',
        });
        return;
      }

      const tokenData = (await tokenResponse.json()) as {
        access_token: string;
        expires_in?: number;
      };
      const accessToken = tokenData.access_token;
      logFacebookOauthDebug('Facebook token exchange succeeded', {
        hasAccessToken: !!tokenData.access_token,
        expiresIn: tokenData.expires_in || null,
      });

      // Get user's Facebook pages (required to discover connected Instagram professional accounts)
      // Note: Creator accounts may surface via `connected_instagram_account` instead of
      // `instagram_business_account`, depending on configuration/API version.
      let nextPagesUrl: string | undefined = fbGraph(
        `me/accounts?access_token=${accessToken}&fields=id,name,access_token,instagram_business_account,connected_instagram_account&limit=100`
      );

      const pages: FacebookPage[] = [];
      let pageWithInstagram: FacebookPage | undefined;
      let pageFetches = 0;

      while (nextPagesUrl && !pageWithInstagram && pageFetches < 10) {
        const pagesResponse = await fetch(nextPagesUrl);

        if (!pagesResponse.ok) {
          const errorText = await pagesResponse.text();
          const graphError = parseFacebookGraphError(errorText);
          const classified = classifyFacebookGraphError(graphError, errorText);
          captureOauthMessage('Instagram OAuth failed to fetch Facebook pages', {
            phase: 'pages_fetch',
            correlationId: request.id,
            brandId: brand.id,
            userId: brand.userId,
            fbGraphApiVersion: FB_GRAPH_API_VERSION,
            httpStatus: pagesResponse.status,
            classifiedError: classified.code,
            facebookErrorCode: graphError?.code,
            facebookErrorSubcode: graphError?.error_subcode,
            facebookTraceId: graphError?.fbtrace_id,
            responseBody: truncate(redactOauthSensitiveDetails(errorText), 2000),
          });
          fastify.log.error(
            { err: redactOauthSensitiveDetails(errorText) },
            'Failed to get pages:'
          );
          reply.code(400);
          sendErrorPage(reply, {
            error: classified.code === 'default' ? 'default' : classified.code,
            errorDescription: classified.description,
            technicalDetails: redactOauthSensitiveDetails(errorText),
          });
          return;
        }

        const pagesData = (await pagesResponse.json()) as PagesResponse;
        if (Array.isArray(pagesData.data) && pagesData.data.length) {
          pages.push(...pagesData.data);
          pageWithInstagram = pagesData.data.find(
            (page) => page.instagram_business_account || page.connected_instagram_account
          );
        }

        logFacebookOauthDebug('Fetched Facebook pages page', {
          fetchIndex: pageFetches,
          returnedCount: Array.isArray(pagesData.data) ? pagesData.data.length : 0,
          aggregatedCount: pages.length,
          hasPagingNext: !!pagesData.paging?.next,
          pages: summarizeFacebookPages(pagesData.data || []),
        });

        nextPagesUrl = pagesData.paging?.next;
        pageFetches += 1;
      }

      // Fallback: in some cases the Pages list response does not include the connected IG fields.
      if (!pageWithInstagram && pages.length) {
        for (const page of pages) {
          if (!page.access_token) continue;
          const pageDetailsUrl = fbGraph(
            `${page.id}?fields=instagram_business_account,connected_instagram_account&access_token=${page.access_token}`
          );
          const pageDetailsResponse = await fetch(pageDetailsUrl);
          if (!pageDetailsResponse.ok) continue;

          const pageDetails = (await pageDetailsResponse.json()) as Pick<
            FacebookPage,
            'instagram_business_account' | 'connected_instagram_account'
          >;

          logFacebookOauthDebug('Fetched Facebook page details', {
            pageId: page.id,
            pageName: page.name || null,
            instagramBusinessAccountId: pageDetails.instagram_business_account?.id || null,
            connectedInstagramAccountId: pageDetails.connected_instagram_account?.id || null,
          });

          if (pageDetails.instagram_business_account || pageDetails.connected_instagram_account) {
            pageWithInstagram = {
              ...page,
              ...pageDetails,
            };
            break;
          }
        }
      }

      if (!pageWithInstagram) {
        fastify.log.warn({ pagesCount: pages.length }, 'No connected Instagram account found');
        logFacebookOauthDebug('No connected Instagram account found after scanning pages', {
          pages: summarizeFacebookPages(pages),
        });
        captureOauthMessage('Instagram OAuth no connected Instagram account found', {
          phase: 'pages_scan',
          correlationId: request.id,
          brandId: brand.id,
          userId: brand.userId,
          pagesCount: pages.length,
          pages: FB_OAUTH_DEBUG_ENABLED ? summarizeFacebookPages(pages) : undefined,
        });
        reply.code(400);
        sendErrorPage(reply, {
          error: 'no_business_account',
          errorDescription:
            'No Instagram Business or Creator account was found connected to your Facebook pages.',
          technicalDetails: `Pages scanned: ${pages.length}. No instagram_business_account or connected_instagram_account fields were returned.`,
          retryUrl: '/brands',
        });
        return;
      }
      const instagramAccountId =
        pageWithInstagram.instagram_business_account?.id ||
        pageWithInstagram.connected_instagram_account?.id;
      const pageAccessToken = pageWithInstagram.access_token;
      logFacebookOauthDebug('Selected Facebook page with Instagram account', {
        pageId: pageWithInstagram.id,
        pageName: pageWithInstagram.name || null,
        instagramBusinessAccountId: pageWithInstagram.instagram_business_account?.id || null,
        connectedInstagramAccountId: pageWithInstagram.connected_instagram_account?.id || null,
        hasPageAccessToken: !!pageAccessToken,
      });

      if (!instagramAccountId || !pageAccessToken) {
        captureOauthMessage('Instagram OAuth incomplete page/account data returned', {
          phase: 'pages_select',
          correlationId: request.id,
          brandId: brand.id,
          userId: brand.userId,
          pageId: pageWithInstagram.id,
          hasPageAccessToken: !!pageAccessToken,
          hasInstagramAccountId: !!instagramAccountId,
        });
        reply.code(400);
        sendErrorPage(reply, {
          error: 'default',
          errorDescription: 'Incomplete account data returned from Facebook. Please try again.',
          technicalDetails: `instagramAccountId: ${instagramAccountId ? 'present' : 'missing'}, pageAccessToken: ${pageAccessToken ? 'present' : 'missing'}`,
          retryUrl: '/brands',
        });
        return;
      }

      // Get Instagram account information
      const instagramUrl = fbGraph(
        `${instagramAccountId}?fields=id,username,name,biography,followers_count,media_count,profile_picture_url&access_token=${pageAccessToken}`
      );
      const instagramResponse = await fetch(instagramUrl);

      if (!instagramResponse.ok) {
        const errorText = await instagramResponse.text();
        const graphError = parseFacebookGraphError(errorText);
        const classified = classifyFacebookGraphError(graphError, errorText);
        captureOauthMessage('Instagram OAuth failed to fetch Instagram profile', {
          phase: 'instagram_profile_fetch',
          correlationId: request.id,
          brandId: brand.id,
          userId: brand.userId,
          fbGraphApiVersion: FB_GRAPH_API_VERSION,
          instagramAccountId,
          pageId: pageWithInstagram.id,
          httpStatus: instagramResponse.status,
          classifiedError: classified.code,
          facebookErrorCode: graphError?.code,
          facebookErrorSubcode: graphError?.error_subcode,
          facebookTraceId: graphError?.fbtrace_id,
          responseBody: truncate(redactOauthSensitiveDetails(errorText), 2000),
        });
        fastify.log.error(
          { err: redactOauthSensitiveDetails(errorText) },
          'Failed to get Instagram profile:'
        );
        reply.code(400);
        sendErrorPage(reply, {
          error: classified.code === 'default' ? 'default' : classified.code,
          errorDescription: classified.description,
          technicalDetails: redactOauthSensitiveDetails(errorText),
          retryUrl: '/brands',
        });
        return;
      }

      const instagramProfile = (await instagramResponse.json()) as InstagramProfile;
      logFacebookOauthDebug('Fetched Instagram profile (sanitized)', {
        instagramAccountId,
        username: instagramProfile.username || null,
        name: instagramProfile.name || null,
        followersCount: instagramProfile.followers_count || null,
        mediaCount: instagramProfile.media_count || null,
      });

      // Add account type since it's not returned by the API
      instagramProfile.account_type = pageWithInstagram.instagram_business_account
        ? 'BUSINESS'
        : 'CREATOR';

      // Store sensitive token in Token Service
      const tokenExpiresAt = tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000)
        : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // Default 60 days

      await tokenServiceClient.storeToken({
        userId: brand.userId,
        brandId: brand.id,
        platform: 'instagram',
        accessToken: pageAccessToken,
        expiresAt: tokenExpiresAt,
        metadata: {
          pageId: pageWithInstagram.id,
          accountId: instagramAccountId,
          profileData: instagramProfile,
        },
      });

      // Update brand with UI metadata only (no sensitive token)
      const updatedBrand = await prisma.brand.update({
        where: { id: brand.id },
        data: {
          // Remove brand-level Instagram fields; all connection details now live
          // in SocialAccount records and the external Token Service.
          preferences: {
            ...preferences,
            oauthState: null,
            oauthStateExpires: null,
            tokenExpiresAt: tokenExpiresAt.toISOString(),
          },
        },
      });

      // Create or update SocialAccount record for Instagram
      await prisma.socialAccount.upsert({
        where: {
          platform_externalAccountId: {
            platform: 'instagram',
            externalAccountId: instagramAccountId,
          },
        },
        create: {
          brandId: brand.id,
          platform: 'instagram',
          externalAccountId: instagramAccountId,
          externalPageId: pageWithInstagram.id,
          username: instagramProfile.username || null,
          displayName: instagramProfile.name || null,
          metadata: JSON.parse(JSON.stringify(instagramProfile)),
        },
        update: {
          externalPageId: pageWithInstagram.id,
          username: instagramProfile.username || null,
          displayName: instagramProfile.name || null,
          metadata: JSON.parse(JSON.stringify(instagramProfile)),
          updatedAt: new Date(),
        },
      });

      // Invalidate cached credentials since user reconnected
      await PublisherCredentialsService.invalidateCredentialsCache(brand.id);

      // Trigger initial sync in background (non-blocking)
      console.log(`[Instagram OAuth] Triggering initial sync for brand ${brand.id}`);
      try {
        // Set user-facing cooldown so UI disables the button immediately
        await redisService.set(`ig-sync-${brand.id}`, Date.now().toString(), 900);
      } catch {}
      instagramService
        .syncPublishedPosts(
          { id: updatedBrand.id },
          {
            maxPosts: 100,
            maxDays: 30,
          }
        )
        .then((results) => {
          console.log(`[Instagram OAuth] Initial sync completed for brand ${brand.id}:`, results);
        })
        .catch((error) => {
          console.error(`[Instagram OAuth] Initial sync failed for brand ${brand.id}:`, error);
        });

      // Fire-and-forget: trigger Brand Analysis now that Instagram is connected
      // Includes a small sample of recent posts with pre-warmed CDN URLs for image analysis
      (async () => {
        try {
          const postsRaw = await instagramService.getRecentPosts({ id: updatedBrand.id }, 20);
          const posts = await Promise.all(
            postsRaw.map(async (p) => {
              let mediaUrl = p.media_url;
              if (
                p.media_type?.toUpperCase() !== 'VIDEO' &&
                typeof p.media_url === 'string' &&
                p.media_url
              ) {
                try {
                  const metadata = await buildAnalysisAssetMetadata({
                    brandId: updatedBrand.id,
                    contentId: p.id,
                    generatedAt: p.timestamp ? new Date(p.timestamp) : new Date(),
                  });
                  const asset = await importImageFromExternalUrl(p.media_url, metadata);
                  mediaUrl = asset.url;
                } catch (e) {
                  fastify.log.warn(
                    { err: e, postId: p.id },
                    'Failed to cache image via assets service for analysis; using original URL'
                  );
                }
              }
              return {
                id: p.id,
                caption: p.caption,
                hashtags: p.hashtags,
                timestamp: p.timestamp,
                like_count: p.like_count,
                comments_count: p.comments_count,
                media_type: p.media_type,
                media_url: mediaUrl,
              };
            })
          );
          await eventBridge.send(
            new PutEventsCommand({
              Entries: [
                {
                  DetailType: 'brand.analysis.requested',
                  Source: 'postolio.brand',
                  EventBusName: EVENT_BUS_NAME,
                  Detail: JSON.stringify({
                    brandId: updatedBrand.id,
                    requestedBy: brand.userId,
                    options: { reason: 'on-connect', maxPosts: 20 },
                    posts,
                  }),
                },
              ],
            })
          );
          fastify.log.info({ brandId: updatedBrand.id }, 'Triggered brand analysis on connect');
        } catch (e) {
          fastify.log.warn(
            { err: e, brandId: updatedBrand.id },
            'Failed to trigger brand analysis'
          );
        }
      })();

      sendSuccessPage(reply, {
        profile: {
          id: instagramProfile.id,
          username: instagramProfile.username,
          name: instagramProfile.name,
          biography: instagramProfile.biography,
          followers_count: instagramProfile.followers_count,
          media_count: instagramProfile.media_count,
          profile_picture_url: instagramProfile.profile_picture_url,
          account_type: instagramProfile.account_type,
        },
        brandName: updatedBrand.name,
      });
      return;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      fastify.log.error({ message }, 'OAuth callback error:');
      captureOauthException(error, {
        phase: 'callback',
        correlationId: request.id,
      });
      reply.code(500);
      sendErrorPage(reply, {
        error: 'default',
        errorDescription: 'Failed to process Instagram connection. Please try again.',
        technicalDetails: message,
        retryUrl: '/brands',
      });
      return;
    }
  });
};

export default instagramOAuthRoutes;
