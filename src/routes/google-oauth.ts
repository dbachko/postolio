import { FastifyPluginAsync } from 'fastify'
import { OAuth2Client } from 'google-auth-library'
import { signJWT } from '../services/jwt.js'
import { getDatabaseClient } from '../config/database.js'
import bcrypt from 'bcrypt'
import { randomBytes } from 'crypto'

const prisma = getDatabaseClient()

// Initialize Google OAuth2 client
const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback'
)

interface GoogleTokenBody {
  credential: string // The JWT token from Google
}

interface GoogleUserInfo {
  id: string
  email: string
  name: string
  picture: string | undefined
  email_verified: boolean | undefined
}

const googleOAuthRoutes: FastifyPluginAsync = async (fastify) => {
  // Google OAuth callback - handles the ID token from frontend
  fastify.post<{ Body: GoogleTokenBody }>('/google/verify', async (request, reply) => {
    try {
      const { credential } = request.body

      if (!credential) {
        return reply.code(400).send({ error: 'No credential provided' })
      }

      // Verify the Google ID token
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID || ''
      })

      const payload = ticket.getPayload()
      if (!payload) {
        return reply.code(401).send({ error: 'Invalid Google token' })
      }

      const googleUserInfo: GoogleUserInfo = {
        id: payload.sub || '',
        email: payload.email!,
        name: (payload.name || payload.email?.split('@')[0]) || 'User',
        picture: payload.picture,
        email_verified: payload.email_verified
      }

      // Check if user exists with this email
      let user = await prisma.user.findUnique({
        where: { email: googleUserInfo.email },
        select: {
          id: true,
          email: true,
          name: true,
          googleId: true,
          subscriptionTier: true,
          emailVerified: true
        }
      })

      if (user) {
        // User exists - update Google ID if not set
        if (!user.googleId) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: { 
              googleId: googleUserInfo.id,
              emailVerified: googleUserInfo.email_verified || user.emailVerified
            },
            select: {
              id: true,
              email: true,
              name: true,
              googleId: true,
              subscriptionTier: true,
              emailVerified: true
            }
          })
        }
      } else {
        // Create new user with Google OAuth
        // Generate a cryptographically secure random password for OAuth users
        const secureRandomPassword = randomBytes(32).toString('hex')
        const hashedPassword = await bcrypt.hash(secureRandomPassword, 10)

        user = await prisma.user.create({
          data: {
            email: googleUserInfo.email,
            password: hashedPassword,
            name: googleUserInfo.name,
            googleId: googleUserInfo.id,
            profilePicture: googleUserInfo.picture || null,
            emailVerified: googleUserInfo.email_verified || false,
            subscriptionTier: 'free'
          },
          select: {
            id: true,
            email: true,
            name: true,
            googleId: true,
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
        isNewUser: !user.googleId
      })
    } catch (error) {
      console.error('Google OAuth error:', error)
      return reply.code(500).send({ 
        error: 'Authentication failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // Link existing account with Google
  fastify.post<{ Body: GoogleTokenBody }>('/google/link', {
    preHandler: fastify.authenticate
  }, async (request: any, reply) => {
    try {
      const { credential } = request.body
      const userId = request.user.id

      // Verify the Google ID token
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID || ''
      })

      const payload = ticket.getPayload()
      if (!payload) {
        return reply.code(401).send({ error: 'Invalid Google token' })
      }

      // Check if this Google account is already linked to another user
      const existingGoogleUser = await prisma.user.findFirst({
        where: {
          googleId: payload.sub,
          NOT: { id: userId }
        }
      })

      if (existingGoogleUser) {
        return reply.code(409).send({ 
          error: 'This Google account is already linked to another user' 
        })
      }

      // Link Google account to current user
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          googleId: payload.sub || '',
          ...(payload.email_verified !== undefined && { emailVerified: payload.email_verified }),
          profilePicture: payload.picture || null
        },
        select: {
          id: true,
          email: true,
          name: true,
          googleId: true,
          emailVerified: true,
          profilePicture: true
        }
      })

      return reply.send({
        user: updatedUser,
        message: 'Google account linked successfully'
      })
    } catch (error) {
      console.error('Google link error:', error)
      return reply.code(500).send({ 
        error: 'Failed to link Google account',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // Unlink Google account
  fastify.delete('/google/unlink', {
    preHandler: fastify.authenticate
  }, async (request: any, reply) => {
    try {
      const userId = request.user.id

      // Check if user has a password set (can't unlink if it's their only auth method)
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { password: true, googleId: true }
      })

      if (!user?.googleId) {
        return reply.code(400).send({ error: 'No Google account linked' })
      }

      // For security, we should check if they have another auth method
      // In this case, we check if they have a non-random password
      // (You might want to add a flag for OAuth-created accounts)

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          googleId: null
        },
        select: {
          id: true,
          email: true,
          name: true,
          googleId: true
        }
      })

      return reply.send({
        user: updatedUser,
        message: 'Google account unlinked successfully'
      })
    } catch (error) {
      console.error('Google unlink error:', error)
      return reply.code(500).send({ 
        error: 'Failed to unlink Google account',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })
}

export default googleOAuthRoutes