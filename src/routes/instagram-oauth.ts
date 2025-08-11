import { FastifyPluginAsync } from 'fastify'

import { verifyJWT } from '../services/jwt.js'
import crypto from 'crypto'

import { getDatabaseClient } from '../config/database.js'

const prisma = getDatabaseClient()

interface AuthorizeQuery {
  brandId: string
  redirectUri?: string
}

interface CallbackQuery {
  code: string
  state: string
  error?: string
  error_description?: string
}

// Environment variables for Meta App
const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || 'test_app_id'
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || 'test_app_secret'
const REDIRECT_URI = process.env.INSTAGRAM_REDIRECT_URI || 'http://localhost:3000/auth/instagram/callback'

// Helper function to verify authentication
function authenticateRequest(request: any, reply: any) {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    reply.status(401).send({ error: 'Authorization header required' })
    return null
  }

  const token = authHeader.substring(7)
  try {
    return verifyJWT(token)
  } catch (error) {
    reply.status(401).send({ error: 'Invalid token' })
    return null
  }
}

const instagramOAuthRoutes: FastifyPluginAsync = async function (fastify) {
  // Initiate Instagram OAuth authorization
  fastify.get<{ Querystring: AuthorizeQuery }>('/authorize', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { brandId } = request.query

      if (!brandId) {
        return reply.status(400).send({ error: 'brandId is required' })
      }

      const userId = user.id

      // Verify brand belongs to user
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: userId,
        },
      })

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found' })
      }

      // Generate secure state parameter
      const state = crypto.randomBytes(32).toString('hex')

      // Store state in database temporarily (expires in 10 minutes)
      await prisma.brand.update({
        where: { id: brandId },
        data: {
          preferences: {
            ...((brand.preferences as any) || {}),
            oauthState: state,
            oauthStateExpires: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          },
        },
      })

      // Build Facebook OAuth URL for Instagram Graph API permissions
      // Note: Instagram Graph API uses Pages API permissions
      const scopes = ['pages_show_list', 'pages_read_engagement', 'business_management'].join(',')

      const authUrl =
        `https://www.facebook.com/dialog/oauth?` +
        `client_id=${FACEBOOK_APP_ID}&` +
        `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
        `scope=${encodeURIComponent(scopes)}&` +
        `state=${state}&` +
        `response_type=code`

      reply.send({
        authUrl,
        state,
      })
    } catch (error) {
      fastify.log.error('OAuth authorization error:', error)
      reply.status(500).send({
        error: 'Failed to initiate OAuth authorization',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  // Handle OAuth callback
  fastify.get<{ Querystring: CallbackQuery }>('/callback', async function (request, reply) {
    try {
      // Handle OAuth errors first
      if (request.query.error) {
        return reply.status(400).send({
          error: request.query.error,
          error_description: request.query.error_description,
        })
      }

      const { code, state } = request.query

      if (!code || !state) {
        return reply.status(400).send({ error: 'code and state are required' })
      }

      // Find brand with matching OAuth state (no auth required - state provides security)
      const brand = await prisma.brand.findFirst({
        where: {
          preferences: {
            path: ['oauthState'],
            equals: state,
          },
        },
      })

      if (!brand) {
        return reply.status(400).send({ error: 'Invalid or expired OAuth state' })
      }

      const preferences = brand.preferences as any

      // Check if state has expired
      if (preferences?.oauthStateExpires && new Date(preferences.oauthStateExpires) < new Date()) {
        return reply.status(400).send({ error: 'OAuth state has expired' })
      }

      // Exchange authorization code for access token
      const tokenExchangeUrl = 'https://graph.facebook.com/v23.0/oauth/access_token'
      const tokenParams = new URLSearchParams({
        client_id: FACEBOOK_APP_ID,
        client_secret: FACEBOOK_APP_SECRET,
        redirect_uri: REDIRECT_URI,
        code: code,
      })

      const tokenResponse = await fetch(`${tokenExchangeUrl}?${tokenParams}`, {
        method: 'GET',
      })

      if (!tokenResponse.ok) {
        const error = await tokenResponse.text()
        fastify.log.error('Token exchange failed:', error)
        return reply.status(400).send({
          error: 'Failed to exchange authorization code for token',
          details: error,
        })
      }

      const tokenData = (await tokenResponse.json()) as {
        access_token: string
        expires_in?: number
      }
      const accessToken = tokenData.access_token

      // Get user's Facebook pages (required for Instagram Business accounts)
      const pagesUrl = `https://graph.facebook.com/v23.0/me/accounts?access_token=${accessToken}&fields=id,name,access_token,instagram_business_account`
      const pagesResponse = await fetch(pagesUrl)

      if (!pagesResponse.ok) {
        const error = await pagesResponse.text()
        fastify.log.error('Failed to get pages:', error)
        return reply.status(400).send({
          error: 'Failed to get Facebook pages',
          details: error,
        })
      }

      const pagesData = (await pagesResponse.json()) as {
        data?: Array<any>
      }

      // Find a page with an Instagram Business account
      const pageWithInstagram = pagesData.data?.find((page: any) => page.instagram_business_account)

      if (!pageWithInstagram) {
        return reply.status(400).send({
          error: 'No Instagram Business account found',
          message: 'Please connect an Instagram Business or Creator account to one of your Facebook pages',
        })
      }

      const instagramAccountId = pageWithInstagram.instagram_business_account.id
      const pageAccessToken = pageWithInstagram.access_token

      // Get Instagram account information
      const instagramUrl = `https://graph.facebook.com/v23.0/${instagramAccountId}?fields=id,username,name,biography,followers_count,media_count,profile_picture_url&access_token=${pageAccessToken}`
      const instagramResponse = await fetch(instagramUrl)

      if (!instagramResponse.ok) {
        const error = await instagramResponse.text()
        fastify.log.error('Failed to get Instagram profile:', error)
        return reply.status(400).send({
          error: 'Failed to get Instagram profile',
          details: error,
        })
      }

      const instagramProfile = (await instagramResponse.json()) as Record<string, any>

      // Add account type since it's not returned by the API
      instagramProfile.account_type = 'BUSINESS'

      // Update brand with real Instagram connection
      await prisma.brand.update({
        where: { id: brand.id },
        data: {
          instagramAccessToken: pageAccessToken,
          instagramPageId: pageWithInstagram.id,
          instagramAccountId: instagramAccountId,
          instagramProfileData: instagramProfile as any,
          preferences: {
            ...preferences,
            oauthState: null,
            oauthStateExpires: null,
            tokenExpiresAt: tokenData.expires_in
              ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
              : null,
          },
        },
      })

      // Return HTML that closes the popup and notifies the parent
      const html = `
        <html>
          <body>
            <script>
              // Notify parent window of success
              if (window.opener) {
                window.opener.postMessage({ 
                  type: 'INSTAGRAM_OAUTH_SUCCESS', 
                  data: { success: true, profile: ${JSON.stringify(instagramProfile)} }
                }, '*');
              }
              // Close popup
              window.close();
            </script>
            <p>Instagram connected successfully! You can close this window.</p>
          </body>
        </html>
      `
      return reply.type('text/html').send(html)
    } catch (error) {
      fastify.log.error('OAuth callback error:', error)
      reply.status(500).send({
        error: 'Failed to process OAuth callback',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })
}

export default instagramOAuthRoutes
