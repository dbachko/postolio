import { nanoid } from 'nanoid'
import { getDatabaseClient } from '../config/database.js'
import { EmailService } from './email.js'
import Redis from 'ioredis'
import { getRedisUrl } from '../utils/redis-url.js'

const prisma = getDatabaseClient()
const redis = new Redis(getRedisUrl())

interface VerificationData {
  userId: string
  email: string
  createdAt: number
}

export class EmailVerificationService {
  private static readonly TOKEN_EXPIRY = 24 * 60 * 60 // 24 hours in seconds
  private static readonly RESEND_COOLDOWN = 5 * 60 // 5 minutes in seconds

  /**
   * Send verification email to user
   */
  static async sendVerificationEmail(userId: string): Promise<{ success: boolean; message: string }> {
    try {
      // Get user details
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, emailVerified: true, name: true }
      })

      if (!user) {
        return {
          success: false,
          message: 'User not found'
        }
      }

      if (user.emailVerified) {
        return {
          success: false,
          message: 'Email already verified'
        }
      }

      // Check for recent verification email (cooldown)
      const cooldownKey = `email-verify-cooldown:${userId}`
      const recentlySent = await redis.get(cooldownKey)
      
      if (recentlySent) {
        return {
          success: false,
          message: 'Verification email recently sent. Please check your inbox or wait a few minutes.'
        }
      }

      // Generate verification token
      const token = nanoid(32)
      const verificationKey = `email-verify:${token}`

      // Store token in Redis with expiry
      const verificationData: VerificationData = {
        userId: user.id,
        email: user.email,
        createdAt: Date.now()
      }

      await redis.setex(
        verificationKey,
        this.TOKEN_EXPIRY,
        JSON.stringify(verificationData)
      )

      // Set cooldown
      await redis.setex(cooldownKey, this.RESEND_COOLDOWN, '1')

      // Send verification email using centralized email service
      const emailResult = await EmailService.sendVerificationEmail(user.email, token)
      
      if (!emailResult.success) {
        // Remove cooldown if email failed to send
        await redis.del(cooldownKey)
        throw new Error(emailResult.error || 'Failed to send email')
      }

      return {
        success: true,
        message: 'Verification email sent! Check your inbox.'
      }
    } catch (error) {
      console.error('Email verification error:', error)
      return {
        success: false,
        message: 'Failed to send verification email. Please try again.'
      }
    }
  }

  /**
   * Verify email with token
   */
  static async verifyEmail(token: string): Promise<{
    success: boolean
    message: string
    userId?: string
  }> {
    try {
      const verificationKey = `email-verify:${token}`
      const data = await redis.get(verificationKey)

      if (!data) {
        return {
          success: false,
          message: 'Invalid or expired verification link'
        }
      }

      const verificationData: VerificationData = JSON.parse(data)

      // Delete the token immediately (one-time use)
      await redis.del(verificationKey)

      // Update user's email verification status
      await prisma.user.update({
        where: { id: verificationData.userId },
        data: { emailVerified: true }
      })

      // Clear cooldown
      const cooldownKey = `email-verify-cooldown:${verificationData.userId}`
      await redis.del(cooldownKey)

      return {
        success: true,
        message: 'Email verified successfully!',
        userId: verificationData.userId
      }
    } catch (error) {
      console.error('Email verification error:', error)
      return {
        success: false,
        message: 'Failed to verify email'
      }
    }
  }

  /**
   * Check if user's email is verified
   */
  static async isEmailVerified(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerified: true }
    })
    
    return user?.emailVerified || false
  }

  /**
   * Get verification status for user
   */
  static async getVerificationStatus(userId: string): Promise<{
    verified: boolean
    email?: string
    canResend: boolean
  }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerified: true, email: true }
    })

    if (!user) {
      return { verified: false, canResend: false }
    }

    // Check if in cooldown
    const cooldownKey = `email-verify-cooldown:${userId}`
    const inCooldown = await redis.get(cooldownKey)

    return {
      verified: user.emailVerified,
      email: user.email,
      canResend: !user.emailVerified && !inCooldown
    }
  }

  /**
   * Check if email service is configured
   */
  static isConfigured(): boolean {
    return EmailService.isConfigured()
  }
}