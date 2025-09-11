import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';

import { getDatabaseClient } from '../config/database.js';
import { PublisherCredentialsService } from '../services/publisher-credentials.js';
import { TokenServiceClient } from '../clients/token-service-client.js';

const prisma = getDatabaseClient();
const tokenServiceClient = new TokenServiceClient();

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
        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId: userId,
          },
        });

        if (!brand) {
          return reply.status(404).send({ error: 'Brand not found' });
        }

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
        const scopes = ['pages_show_list', 'pages_read_engagement', 'business_management'].join(
          ','
        );

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
        // Escape HTML to prevent XSS
        const escapeHtml = (str: string) => {
          return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
        };

        const errorMessage = escapeHtml(
          request.query.error_description ||
            request.query.error ||
            'An error occurred during authorization'
        );

        const errorHtml = `
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Connection Failed</title>
              <style>
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  height: 100vh;
                  margin: 0;
                  background-color: #f5f5f5;
                }
                .container {
                  text-align: center;
                  padding: 2rem;
                  background: white;
                  border-radius: 8px;
                  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                  max-width: 400px;
                }
                .error {
                  color: #ef4444;
                  font-size: 3rem;
                  margin-bottom: 1rem;
                  font-weight: bold;
                }
                .message {
                  color: #6b7280;
                  margin-top: 1rem;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="error">&#10005;</div>
                <h2>Connection Failed</h2>
                <p>${errorMessage}</p>
                <p class="message">Please close this window and try again.</p>
              </div>
              <script>
                // Notify parent window of failure
                if (window.opener && !window.opener.closed) {
                  try {
                    window.opener.postMessage({ 
                      type: 'INSTAGRAM_OAUTH_ERROR', 
                      data: { 
                        success: false, 
                        error: ${JSON.stringify(request.query.error)},
                        error_description: ${JSON.stringify(request.query.error_description || '')}
                      }
                    }, window.location.origin);
                  } catch (e) {
                    console.error('Failed to send message to parent window:', e);
                  }
                }
                // Close after delay
                setTimeout(function() {
                  window.close();
                }, 5000);
              </script>
            </body>
          </html>
        `;
        return reply.type('text/html').send(errorHtml);
      }

      const { code, state } = request.query;

      if (!code || !state) {
        return reply.status(400).send({ error: 'code and state are required' });
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
        return reply.status(400).send({ error: 'Invalid or expired OAuth state' });
      }

      const preferences: Record<string, unknown> =
        typeof brand.preferences === 'object' && brand.preferences
          ? (brand.preferences as Record<string, unknown>)
          : {};

      // Check if state has expired
      const expiresRaw = preferences?.oauthStateExpires;
      if (typeof expiresRaw === 'string' && new Date(expiresRaw) < new Date()) {
        return reply.status(400).send({ error: 'OAuth state has expired' });
      }

      // Exchange authorization code for access token
      const tokenExchangeUrl = 'https://graph.facebook.com/v23.0/oauth/access_token';
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
        const error = await tokenResponse.text();
        fastify.log.error({ err: error }, 'Token exchange failed:');
        return reply.status(400).send({
          error: 'Failed to exchange authorization code for token',
          details: error,
        });
      }

      const tokenData = (await tokenResponse.json()) as {
        access_token: string;
        expires_in?: number;
      };
      const accessToken = tokenData.access_token;

      // Get user's Facebook pages (required for Instagram Business accounts)
      const pagesUrl = `https://graph.facebook.com/v23.0/me/accounts?access_token=${accessToken}&fields=id,name,access_token,instagram_business_account`;
      const pagesResponse = await fetch(pagesUrl);

      if (!pagesResponse.ok) {
        const error = await pagesResponse.text();
        fastify.log.error({ err: error }, 'Failed to get pages:');
        return reply.status(400).send({
          error: 'Failed to get Facebook pages',
          details: error,
        });
      }

      const pagesData = (await pagesResponse.json()) as PagesResponse;

      // Find a page with an Instagram Business account
      const pageWithInstagram = pagesData.data?.find((page) => page.instagram_business_account);

      if (!pageWithInstagram) {
        return reply.status(400).send({
          error: 'No Instagram Business account found',
          message:
            'Please connect an Instagram Business or Creator account to one of your Facebook pages',
        });
      }

      const instagramAccountId = pageWithInstagram.instagram_business_account?.id;
      const pageAccessToken = pageWithInstagram.access_token;

      if (!instagramAccountId || !pageAccessToken) {
        return reply.status(400).send({
          error: 'Incomplete Instagram page data returned from Facebook API',
        });
      }

      // Get Instagram account information
      const instagramUrl = `https://graph.facebook.com/v23.0/${instagramAccountId}?fields=id,username,name,biography,followers_count,media_count,profile_picture_url&access_token=${pageAccessToken}`;
      const instagramResponse = await fetch(instagramUrl);

      if (!instagramResponse.ok) {
        const error = await instagramResponse.text();
        fastify.log.error({ err: error }, 'Failed to get Instagram profile:');
        return reply.status(400).send({
          error: 'Failed to get Instagram profile',
          details: error,
        });
      }

      const instagramProfile = (await instagramResponse.json()) as InstagramProfile;

      // Add account type since it's not returned by the API
      instagramProfile.account_type = 'BUSINESS';

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
      await prisma.brand.update({
        where: { id: brand.id },
        data: {
          // Remove instagramAccessToken - now stored in Token Service
          instagramPageId: pageWithInstagram.id,
          instagramAccountId: instagramAccountId,
          instagramProfileData: JSON.parse(JSON.stringify(instagramProfile)),
          preferences: {
            ...preferences,
            oauthState: null,
            oauthStateExpires: null,
            tokenExpiresAt: tokenExpiresAt.toISOString(),
          },
        },
      });

      // Invalidate cached credentials since user reconnected
      await PublisherCredentialsService.invalidateCredentialsCache(brand.id);

      // Return HTML that closes the popup and notifies the parent
      const html = `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Instagram Connected</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                background-color: #f5f5f5;
              }
              .container {
                text-align: center;
                padding: 2rem;
                background: white;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
              }
              .success {
                color: #10b981;
                font-size: 3rem;
                margin-bottom: 1rem;
                font-weight: bold;
              }
              .message {
                color: #6b7280;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="success">&#10003;</div>
              <h2>Instagram Connected Successfully!</h2>
              <p class="message">You can close this window.</p>
            </div>
            <script>
              // Notify parent window of success
              if (window.opener && !window.opener.closed) {
                try {
                  window.opener.postMessage({ 
                    type: 'INSTAGRAM_OAUTH_SUCCESS', 
                    data: { 
                      success: true, 
                      profile: ${JSON.stringify(instagramProfile)} 
                    }
                  }, window.location.origin);
                  
                  // Give time for the message to be received before closing
                  setTimeout(function() {
                    window.close();
                  }, 1500);
                } catch (e) {
                  console.error('Failed to send message to parent window:', e);
                  // Still try to close after a delay
                  setTimeout(function() {
                    window.close();
                  }, 3000);
                }
              } else {
                // No parent window, just show success message
                setTimeout(function() {
                  window.close();
                }, 3000);
              }
            </script>
          </body>
        </html>
      `;
      return reply.type('text/html').send(html);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      fastify.log.error({ message }, 'OAuth callback error:');
      reply.status(500).send({
        error: 'Failed to process OAuth callback',
        message,
      });
    }
  });
};

export default instagramOAuthRoutes;
