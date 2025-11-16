import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { EventBridge, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import crypto from 'crypto';

import { getDatabaseClient } from '../config/database.js';
import { PublisherCredentialsService } from '../services/publisher-credentials.js';
import { TokenServiceClient } from '../clients/token-service-client.js';
import { instagramService } from '../services/instagram.js';
import { importImageFromExternalUrl } from '../services/assets-media.js';
import { buildAnalysisAssetMetadata } from '../services/brand-analysis-assets.js';
import { redisService } from '../services/redis.js';
import { sendErrorPage } from '../utils/oauth-error-pages.js';
import { sendSuccessPage } from '../utils/oauth-success-page.js';
import { OAuthAuditService } from '../services/oauth-audit.js';

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

const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || 'test_app_id';
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || 'test_app_secret';
const REDIRECT_URI =
  process.env.INSTAGRAM_REDIRECT_URI || 'http://localhost:3000/api/auth/instagram/callback';

function ensureAuth(
  request: FastifyRequest,
  reply: FastifyReply
): request is FastifyRequest & { user: { id: string; email?: string } } {
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
}

interface PagesResponse {
  data?: FacebookPage[];
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

const instagramOAuthRoutes: FastifyPluginAsync = async function (fastify) {
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
        const userEmail = (request.user as any).email as string | undefined;

        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId: userId,
          },
        });

        if (!brand) {
          return reply.status(404).send({ error: 'Brand not found' });
        }

        const state = crypto.randomBytes(32).toString('hex');

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

        const scopes = [
          'pages_show_list',
          'pages_read_engagement',
          'pages_manage_posts',
          'business_management',
          'instagram_content_publish',
        ].join(',');

        const authUrl =
          `https://www.facebook.com/dialog/oauth?` +
          `client_id=${FACEBOOK_APP_ID}&` +
          `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
          `scope=${encodeURIComponent(scopes)}&` +
          `state=${state}&` +
          `response_type=code`;

        await OAuthAuditService.trackEvent({
          event: {
            platform: 'instagram',
            event: 'authorize_started',
            userId,
            email: userEmail,
            brandId,
            metadata: {
              brandName: brand.name,
            },
          },
          request,
        });

        reply.send({
          authUrl,
          state,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        fastify.log.error({ message }, 'OAuth authorization error:');
        reply.status(500).send({
          error: 'Failed to initiate OAuth authorization',
          message,
        });
      }
    }
  );

  fastify.get<{ Querystring: CallbackQuery }>('/callback', async function (request, reply) {
    try {
      await OAuthAuditService.trackEvent({
        event: {
          platform: 'instagram',
          event: 'callback_received',
        },
        request,
      });

      if (request.query.error) {
        fastify.log.warn(
          {
            error: request.query.error,
            error_description: request.query.error_description,
          },
          'Instagram OAuth error'
        );

        await OAuthAuditService.trackEvent({
          event: {
            platform: 'instagram',
            event: 'connection_error',
            error: request.query.error,
            errorDescription: request.query.error_description,
            metadata: {
              source: 'oauth_callback',
            },
          },
          request,
        });

        return sendErrorPage(reply, {
          error: request.query.error,
          errorDescription: request.query.error_description,
        });
      }

      const { code, state } = request.query;

      if (!code || !state) {
        return sendErrorPage(reply, {
          error: 'invalid_request',
          errorDescription: 'Missing required parameters. Please try connecting again.',
          technicalDetails: 'code and state parameters are required',
        });
      }

      const brand = await prisma.brand.findFirst({
        where: {
          preferences: {
            path: ['oauthState'],
            equals: state,
          },
        },
      });

      if (!brand) {
        fastify.log.warn({ state }, 'Invalid or expired OAuth state');
        return sendErrorPage(reply, {
          error: 'invalid_state',
          errorDescription: 'Your authorization session has expired. Please try connecting again.',
          technicalDetails: 'OAuth state not found or expired',
        });
      }

      const preferences: Record<string, unknown> =
        typeof brand.preferences === 'object' && brand.preferences
          ? (brand.preferences as Record<string, unknown>)
          : {};

      const expiresRaw = (preferences as any)?.oauthStateExpires;
      if (typeof expiresRaw === 'string' && new Date(expiresRaw) < new Date()) {
        fastify.log.warn({ state, expiresRaw }, 'OAuth state expired');
        return sendErrorPage(reply, {
          error: 'invalid_state',
          errorDescription: 'Your authorization session has expired. Please try connecting again.',
          technicalDetails: 'OAuth state has expired',
        });
      }

      const FB_GRAPH_API_VERSION = process.env.FB_GRAPH_API_VERSION || 'v24.0';
      const fbGraph = (path: string) =>
        `https://graph.facebook.com/${FB_GRAPH_API_VERSION}/${path}`;

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
        fastify.log.error({ err: errorText }, 'Token exchange failed:');
        return sendErrorPage(reply, {
          error: 'token_exchange_failed',
          errorDescription: 'Failed to complete the Instagram connection. Please try again.',
          technicalDetails: errorText,
        });
      }

      const tokenData = (await tokenResponse.json()) as {
        access_token: string;
        expires_in?: number;
      };
      const accessToken = tokenData.access_token;

      const pagesUrl = fbGraph(
        `me/accounts?access_token=${accessToken}&fields=id,name,access_token,instagram_business_account`
      );
      const pagesResponse = await fetch(pagesUrl);

      if (!pagesResponse.ok) {
        const errorText = await pagesResponse.text();
        fastify.log.error({ err: errorText }, 'Failed to get Facebook pages:');
        return sendErrorPage(reply, {
          error: 'api_error',
          errorDescription: 'Failed to retrieve your Facebook pages. Please try again.',
          technicalDetails: errorText,
        });
      }

      const pagesData = (await pagesResponse.json()) as PagesResponse;

      const pageWithInstagram = pagesData.data?.find((page) => page.instagram_business_account);

      if (!pageWithInstagram) {
        fastify.log.warn(
          { pagesCount: pagesData.data?.length || 0 },
          'No Instagram Business account found'
        );

        return sendErrorPage(reply, {
          error: 'no_business_account',
          errorDescription: 'No Instagram Business account found connected to your Facebook pages.',
          technicalDetails: `Found ${pagesData.data?.length || 0} Facebook pages but none have Instagram Business accounts connected`,
        });
      }

      const instagramAccountId = pageWithInstagram.instagram_business_account?.id;
      const pageAccessToken = pageWithInstagram.access_token;

      if (!instagramAccountId || !pageAccessToken) {
        fastify.log.error(
          {
            hasAccountId: !!instagramAccountId,
            hasToken: !!pageAccessToken,
            pageId: pageWithInstagram.id,
          },
          'Incomplete Instagram data'
        );

        return sendErrorPage(reply, {
          error: 'incomplete_data',
          errorDescription: 'Instagram account data is incomplete. Please try reconnecting.',
          technicalDetails: 'Missing Instagram account ID or page access token',
        });
      }

      const instagramUrl = fbGraph(
        `${instagramAccountId}?fields=id,username,name,biography,followers_count,media_count,profile_picture_url&access_token=${pageAccessToken}`
      );
      const instagramResponse = await fetch(instagramUrl);

      if (!instagramResponse.ok) {
        const errorText = await instagramResponse.text();
        fastify.log.error(
          {
            err: errorText,
            accountId: instagramAccountId,
          },
          'Failed to get Instagram profile:'
        );

        return sendErrorPage(reply, {
          error: 'profile_error',
          errorDescription: 'Failed to retrieve your Instagram profile information.',
          technicalDetails: errorText,
        });
      }

      const instagramProfile = (await instagramResponse.json()) as InstagramProfile;
      instagramProfile.account_type = 'BUSINESS';

      const tokenExpiresAt = tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000)
        : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

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

      const updatedBrand = await prisma.brand.update({
        where: { id: brand.id },
        data: {
          preferences: {
            ...preferences,
            oauthState: null,
            oauthStateExpires: null,
            tokenExpiresAt: tokenExpiresAt.toISOString(),
          },
        },
      });

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

      await PublisherCredentialsService.invalidateCredentialsCache(brand.id);

      fastify.log.info(
        {
          brandId: brand.id,
          instagramAccountId,
          username: instagramProfile.username,
        },
        'Instagram account connected successfully'
      );

      instagramService
        .syncPublishedPosts(
          { id: updatedBrand.id },
          {
            maxPosts: 100,
            maxDays: 30,
          }
        )
        .then((results) => {
          fastify.log.info(
            { brandId: brand.id, results },
            '[Instagram OAuth] Initial sync completed for brand'
          );
        })
        .catch((error) => {
          fastify.log.error(
            { brandId: brand.id, error },
            '[Instagram OAuth] Initial sync failed for brand'
          );
        });

      try {
        await redisService.set(`ig-sync-${brand.id}`, Date.now().toString(), 900);
      } catch {}

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

      await OAuthAuditService.trackEvent({
        event: {
          platform: 'instagram',
          event: 'connection_success',
          userId: brand.userId,
          brandId: brand.id,
          metadata: {
            instagramAccountId,
            username: instagramProfile.username,
          },
        },
        request,
      });

      return sendSuccessPage(reply, {
        profile: instagramProfile,
        brandName: brand.name,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      fastify.log.error({ message }, 'OAuth callback error:');

      await OAuthAuditService.trackEvent({
        event: {
          platform: 'instagram',
          event: 'connection_error',
          error: 'unexpected_error',
          errorDescription: message,
          metadata: {
            source: 'unexpected_exception',
          },
        },
        request,
      });

      reply.status(500).send({
        error: 'Failed to process OAuth callback',
        message,
      });
    }
  });
};

export default instagramOAuthRoutes;
