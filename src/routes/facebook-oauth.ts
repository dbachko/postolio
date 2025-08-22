import { FastifyPluginAsync } from 'fastify'
import { signJWT } from '../services/jwt.js'
import { getDatabaseClient } from '../config/database.js'
import bcrypt from 'bcrypt'
import { randomBytes } from 'crypto'
import axios from 'axios'

const prisma = getDatabaseClient()

// Facebook App configuration
const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || ''
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || ''
const FACEBOOK_REDIRECT_URI = process.env.FACEBOOK_OAUTH_REDIRECT_URI || 'http://localhost:3000/api/auth/facebook/callback'

interface FacebookTokenBody {
  code: string // The authorization code from Facebook
  redirectUri?: string
}

interface FacebookUserInfo {
  id: string
  email?: string
  name: string
  picture?: {
    data: {
      url: string
    }
  }
}

const facebookOAuthRoutes: FastifyPluginAsync = async (fastify) => {
  // Facebook OAuth callback - exchanges code for token and gets user info
  fastify.post<{ Body: FacebookTokenBody }>('/facebook/callback', async (request, reply) => {
    try {
      const { code, redirectUri = FACEBOOK_REDIRECT_URI } = request.body

      if (!code) {
        return reply.code(400).send({ error: 'No authorization code provided' })
      }

      // Exchange code for access token
      const tokenResponse = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
        params: {
          client_id: FACEBOOK_APP_ID,
          client_secret: FACEBOOK_APP_SECRET,
          redirect_uri: redirectUri,
          code
        }
      })

      const { access_token } = tokenResponse.data

      if (!access_token) {
        return reply.code(401).send({ error: 'Failed to get access token from Facebook' })
      }

      // Get user information from Facebook
      const userResponse = await axios.get('https://graph.facebook.com/v18.0/me', {
        params: {
          fields: 'id,email,name,picture',
          access_token
        }
      })

      const fbUserInfo: FacebookUserInfo = userResponse.data

      // Facebook may not provide email in some cases
      const email = fbUserInfo.email || `${fbUserInfo.id}@facebook.local`
      
      // Check if user exists with this email or Facebook ID
      let user = await prisma.user.findFirst({
        where: {
          OR: [
            { email },
            { facebookId: fbUserInfo.id }
          ]
        },
        select: {
          id: true,
          email: true,
          name: true,
          facebookId: true,
          subscriptionTier: true,
          emailVerified: true
        }
      })

      if (user) {
        // User exists - update Facebook ID if not set
        if (!user.facebookId) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: { 
              facebookId: fbUserInfo.id,
              profilePicture: fbUserInfo.picture?.data?.url || null
            },
            select: {
              id: true,
              email: true,
              name: true,
              facebookId: true,
              subscriptionTier: true,
              emailVerified: true
            }
          })
        }
      } else {
        // Create new user with Facebook OAuth
        // Generate a cryptographically secure random password for OAuth users
        const secureRandomPassword = randomBytes(32).toString('hex')
        const hashedPassword = await bcrypt.hash(secureRandomPassword, 10)

        user = await prisma.user.create({
          data: {
            email,
            password: hashedPassword,
            name: fbUserInfo.name,
            facebookId: fbUserInfo.id,
            profilePicture: fbUserInfo.picture?.data?.url || null,
            emailVerified: !!fbUserInfo.email, // Only verified if we got a real email
            subscriptionTier: 'free'
          },
          select: {
            id: true,
            email: true,
            name: true,
            facebookId: true,
            subscriptionTier: true,
            emailVerified: true
          }
        })
      }

      // Generate JWT token
      const token = signJWT({
        id: user.id,
        email: user.email
      })

      // Set HTTP-only cookie for enhanced security
      reply.setCookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 // 7 days
      })

      return reply.send({
        token,
        user,
        isNewUser: !user.facebookId
      })
    } catch (error) {
      console.error('Facebook OAuth error:', error)
      
      // Handle specific Facebook API errors
      if (axios.isAxiosError(error)) {
        const fbError = error.response?.data?.error
        if (fbError) {
          return reply.code(400).send({ 
            error: 'Facebook authentication failed',
            details: fbError.message || 'Unknown Facebook error'
          })
        }
      }
      
      return reply.code(500).send({ 
        error: 'Authentication failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // Link existing account with Facebook
  fastify.post<{ Body: FacebookTokenBody }>('/facebook/link', {
    preHandler: fastify.authenticate
  }, async (request: any, reply) => {
    try {
      const { code, redirectUri = FACEBOOK_REDIRECT_URI } = request.body
      const userId = request.user.id

      // Exchange code for access token
      const tokenResponse = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
        params: {
          client_id: FACEBOOK_APP_ID,
          client_secret: FACEBOOK_APP_SECRET,
          redirect_uri: redirectUri,
          code
        }
      })

      const { access_token } = tokenResponse.data

      // Get user information
      const userResponse = await axios.get('https://graph.facebook.com/v18.0/me', {
        params: {
          fields: 'id,picture',
          access_token
        }
      })

      const fbUserInfo: FacebookUserInfo = userResponse.data

      // Check if this Facebook account is already linked to another user
      const existingFacebookUser = await prisma.user.findFirst({
        where: {
          facebookId: fbUserInfo.id,
          NOT: { id: userId }
        }
      })

      if (existingFacebookUser) {
        return reply.code(409).send({ 
          error: 'This Facebook account is already linked to another user' 
        })
      }

      // Link Facebook account to current user
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          facebookId: fbUserInfo.id,
          profilePicture: fbUserInfo.picture?.data?.url || null
        },
        select: {
          id: true,
          email: true,
          name: true,
          facebookId: true,
          profilePicture: true
        }
      })

      return reply.send({
        user: updatedUser,
        message: 'Facebook account linked successfully'
      })
    } catch (error) {
      console.error('Facebook link error:', error)
      return reply.code(500).send({ 
        error: 'Failed to link Facebook account',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // Unlink Facebook account
  fastify.delete('/facebook/unlink', {
    preHandler: fastify.authenticate
  }, async (request: any, reply) => {
    try {
      const userId = request.user.id

      // Check if user has a Facebook account linked
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { facebookId: true }
      })

      if (!user?.facebookId) {
        return reply.code(400).send({ error: 'No Facebook account linked' })
      }

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          facebookId: null
        },
        select: {
          id: true,
          email: true,
          name: true,
          facebookId: true
        }
      })

      return reply.send({
        user: updatedUser,
        message: 'Facebook account unlinked successfully'
      })
    } catch (error) {
      console.error('Facebook unlink error:', error)
      return reply.code(500).send({ 
        error: 'Failed to unlink Facebook account',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // Get Facebook login URL
  fastify.get('/facebook/login-url', async (request, reply) => {
    const params = new URLSearchParams({
      client_id: FACEBOOK_APP_ID,
      redirect_uri: FACEBOOK_REDIRECT_URI,
      scope: 'email,public_profile',
      response_type: 'code',
      auth_type: 'rerequest',
      display: 'popup'
    })

    const loginUrl = `https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`
    
    return reply.send({ url: loginUrl })
  })
}

export default facebookOAuthRoutes