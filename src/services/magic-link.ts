import { nanoid } from 'nanoid'
import { randomBytes } from 'crypto'
import bcrypt from 'bcrypt'
import { getDatabaseClient } from '../config/database.js'
import { signJWT } from './jwt.js'
import { EmailService } from './email.js'
import Redis from 'ioredis'
import { getRedisUrl } from '../utils/redis-url.js'

const prisma = getDatabaseClient()
const redis = new Redis(getRedisUrl())

interface MagicLinkData {
  email: string
  token: string
  createdAt: number
  isSignUp?: boolean
}

export class MagicLinkService {
  private static readonly TOKEN_EXPIRY = 15 * 60 // 15 minutes in seconds
  private static readonly RATE_LIMIT_WINDOW = 60 * 60 // 1 hour in seconds
  private static readonly MAX_ATTEMPTS = 5 // Max attempts per hour

  /**
   * Generate and send a magic link to the user's email
   */
  static async sendMagicLink(email: string, isSignUp = false): Promise<{ success: boolean; message: string }> {
    try {
      // Normalize email
      email = email.toLowerCase().trim()

      // Check rate limiting
      const rateLimitKey = `magic-link-rate:${email}`
      const attempts = await redis.incr(rateLimitKey)
      
      if (attempts === 1) {
        await redis.expire(rateLimitKey, this.RATE_LIMIT_WINDOW)
      }
      
      if (attempts > this.MAX_ATTEMPTS) {
        return {
          success: false,
          message: 'Too many attempts. Please try again later.'
        }
      }

      // Check if user exists (for sign-in)
      if (!isSignUp) {
        const existingUser = await prisma.user.findUnique({
          where: { email }
        })

        if (!existingUser) {
          // Don't reveal if email exists or not for security
          return {
            success: true,
            message: 'If an account exists with this email, a magic link has been sent.'
          }
        }
      }

      // Generate secure token
      const token = nanoid(32)
      const magicLinkKey = `magic-link:${token}`

      // Store token in Redis with expiry
      const magicLinkData: MagicLinkData = {
        email,
        token,
        createdAt: Date.now(),
        isSignUp
      }

      await redis.setex(
        magicLinkKey,
        this.TOKEN_EXPIRY,
        JSON.stringify(magicLinkData)
      )

      // Send magic link email using centralized email service
      const emailResult = await EmailService.sendMagicLink(email, token, isSignUp)
      
      if (!emailResult.success) {
        throw new Error(emailResult.error || 'Failed to send email')
      }

      return {
        success: true,
        message: 'Magic link sent! Check your email to continue.'
      }
    } catch (error) {
      console.error('Magic link error:', error)
      return {
        success: false,
        message: 'Failed to send magic link. Please try again.'
      }
    }
  }

  /**
   * Verify a magic link token and sign in the user
   */
  static async verifyMagicLink(token: string): Promise<{
    success: boolean
    user?: any
    token?: string
    message?: string
  }> {
    try {
      const magicLinkKey = `magic-link:${token}`
      const data = await redis.get(magicLinkKey)

      if (!data) {
        return {
          success: false,
          message: 'Invalid or expired magic link'
        }
      }

      const magicLinkData: MagicLinkData = JSON.parse(data)

      // Delete the token immediately (one-time use)
      await redis.del(magicLinkKey)

      // Find or create user
      let user = await prisma.user.findUnique({
        where: { email: magicLinkData.email },
        select: {
          id: true,
          email: true,
          name: true,
          subscriptionTier: true,
          emailVerified: true
        }
      })

      if (!user && magicLinkData.isSignUp) {
        // Create new user with cryptographically secure random password
        const secureRandomPassword = randomBytes(32).toString('hex')
        const hashedPassword = await bcrypt.hash(secureRandomPassword, 10)
        
        user = await prisma.user.create({
          data: {
            email: magicLinkData.email,
            password: hashedPassword, // Properly hashed password
            emailVerified: true, // Email is verified through magic link
            subscriptionTier: 'free'
          },
          select: {
            id: true,
            email: true,
            name: true,
            subscriptionTier: true,
            emailVerified: true
          }
        })
      } else if (!user) {
        return {
          success: false,
          message: 'No account found with this email'
        }
      } else {
        // Update email verification status
        if (!user.emailVerified) {
          await prisma.user.update({
            where: { id: user.id },
            data: { emailVerified: true }
          })
          user.emailVerified = true
        }
      }

      // Generate JWT token
      const jwtToken = signJWT({
        id: user.id,
        email: user.email
      })

      return {
        success: true,
        user,
        token: jwtToken
      }
    } catch (error) {
      console.error('Magic link verification error:', error)
      return {
        success: false,
        message: 'Failed to verify magic link'
      }
    }
  }

  /**
   * Check if email service is configured
   */
  static isConfigured(): boolean {
    return EmailService.isConfigured()
  }
}