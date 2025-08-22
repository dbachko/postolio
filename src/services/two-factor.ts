import speakeasy from 'speakeasy'
import QRCode from 'qrcode'
import { getDatabaseClient } from '../config/database.js'
import { AuditLogger, AuditEventType } from './audit-logger.js'
import Redis from 'ioredis'
import { EmailService } from './email.js'
import { randomBytes } from 'crypto'
import { Prisma } from '@prisma/client'

const prisma = getDatabaseClient()
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379')

export enum TwoFactorMethod {
  TOTP = 'totp',     // Time-based One-Time Password (Google Authenticator)
  EMAIL = 'email',   // Email verification code
  SMS = 'sms'        // SMS verification code (future implementation)
}

interface _TwoFactorSetup {
  userId: string
  method: TwoFactorMethod
  secret?: string
  backupCodes?: string[]
  phoneNumber?: string
  email?: string
  verified: boolean
  createdAt: Date
  updatedAt: Date
}

export class TwoFactorService {
  private static readonly CODE_EXPIRY = 5 * 60 // 5 minutes in seconds
  private static readonly MAX_ATTEMPTS = 3
  private static readonly BACKUP_CODE_COUNT = 10

  /**
   * Enable two-factor authentication for a user
   */
  static async setupTwoFactor(
    userId: string,
    method: TwoFactorMethod,
    phoneNumber?: string
  ): Promise<{
    success: boolean
    qrCode?: string
    secret?: string
    backupCodes?: string[]
    message?: string
  }> {
    try {
      // Check if 2FA is already enabled
      const existing = await prisma.user.findUnique({
        where: { id: userId },
        select: { 
          twoFactorEnabled: true,
          twoFactorMethod: true,
          email: true
        }
      })

      if (existing?.twoFactorEnabled) {
        return {
          success: false,
          message: 'Two-factor authentication is already enabled'
        }
      }

      let result: any = { success: true }

      switch (method) {
        case TwoFactorMethod.TOTP:
          result = await this.setupTOTP(userId)
          break
        case TwoFactorMethod.EMAIL:
          result = await this.setupEmail(userId, existing?.email!)
          break
        case TwoFactorMethod.SMS:
          if (!phoneNumber) {
            return {
              success: false,
              message: 'Phone number is required for SMS authentication'
            }
          }
          result = await this.setupSMS(userId, phoneNumber)
          break
        default:
          return {
            success: false,
            message: 'Invalid two-factor method'
          }
      }

      // Generate backup codes
      const backupCodes = this.generateBackupCodes()
      const hashedBackupCodes = await Promise.all(
        backupCodes.map(code => this.hashBackupCode(code))
      )

      // Store temporarily until verified
      await redis.setex(
        `2fa-setup:${userId}`,
        60 * 30, // 30 minutes to complete setup
        JSON.stringify({
          method,
          secret: result.secret,
          backupCodes: hashedBackupCodes,
          phoneNumber
        })
      )

      return {
        ...result,
        backupCodes
      }
    } catch (error) {
      console.error('2FA setup error:', error)
      return {
        success: false,
        message: 'Failed to setup two-factor authentication'
      }
    }
  }

  /**
   * Setup TOTP (Google Authenticator)
   */
  private static async setupTOTP(userId: string): Promise<{
    success: boolean
    qrCode?: string
    secret?: string
    message?: string
  }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true }
    })

    // Generate secret
    const secret = speakeasy.generateSecret({
      name: `Postolio (${user?.email})`,
      issuer: 'Postolio',
      length: 32
    })

    // Generate QR code
    const otpauthUrl = speakeasy.otpauthURL({
      secret: secret.base32,
      label: user?.email || 'user',
      issuer: 'Postolio',
      encoding: 'base32'
    })

    const qrCode = await QRCode.toDataURL(otpauthUrl)

    return {
      success: true,
      qrCode,
      secret: secret.base32
    }
  }

  /**
   * Setup Email 2FA
   */
  private static async setupEmail(userId: string, email: string): Promise<{
    success: boolean
    message?: string
  }> {
    // Generate and send verification code
    const code = this.generateNumericCode()
    
    await redis.setex(
      `2fa-email-code:${userId}`,
      this.CODE_EXPIRY,
      code
    )

    const emailResult = await EmailService.sendTwoFactorCode(email, code)
    
    if (!emailResult.success) {
      throw new Error('Failed to send verification code')
    }

    return {
      success: true,
      message: 'Verification code sent to your email'
    }
  }

  /**
   * Setup SMS 2FA (placeholder for future implementation)
   */
  private static async setupSMS(_userId: string, _phoneNumber: string): Promise<{
    success: boolean
    message?: string
  }> {
    // TODO: Implement SMS provider integration (Twilio, AWS SNS, etc.)
    return {
      success: false,
      message: 'SMS authentication not yet implemented'
    }
  }

  /**
   * Verify two-factor setup
   */
  static async verifySetup(
    userId: string,
    code: string,
    ipAddress?: string
  ): Promise<{
    success: boolean
    message?: string
  }> {
    try {
      // Get setup data
      const setupData = await redis.get(`2fa-setup:${userId}`)
      if (!setupData) {
        return {
          success: false,
          message: 'Setup session expired. Please start over.'
        }
      }

      const setup = JSON.parse(setupData)

      // Verify based on method
      let verified = false
      switch (setup.method) {
        case TwoFactorMethod.TOTP:
          verified = speakeasy.totp.verify({
            secret: setup.secret,
            encoding: 'base32',
            token: code,
            window: 2
          })
          break
        case TwoFactorMethod.EMAIL: {
          const storedCode = await redis.get(`2fa-email-code:${userId}`)
          verified = storedCode === code
          break
        }
        case TwoFactorMethod.SMS:
          // TODO: Implement SMS verification
          break
      }

      if (!verified) {
        // Track failed attempts
        const attemptsKey = `2fa-setup-attempts:${userId}`
        const attempts = await redis.incr(attemptsKey)
        await redis.expire(attemptsKey, 60 * 5) // 5 minutes

        if (attempts >= this.MAX_ATTEMPTS) {
          await redis.del(`2fa-setup:${userId}`)
          return {
            success: false,
            message: 'Too many failed attempts. Setup cancelled.'
          }
        }

        return {
          success: false,
          message: 'Invalid verification code'
        }
      }

      // Enable 2FA for user
      await prisma.user.update({
        where: { id: userId },
        data: {
          twoFactorEnabled: true,
          twoFactorMethod: setup.method,
          twoFactorSecret: setup.secret,
          twoFactorBackupCodes: setup.backupCodes,
          twoFactorPhoneNumber: setup.phoneNumber
        }
      })

      // Clean up Redis
      await redis.del(`2fa-setup:${userId}`)
      await redis.del(`2fa-setup-attempts:${userId}`)
      await redis.del(`2fa-email-code:${userId}`)

      // Log successful 2FA setup
      await AuditLogger.log({
        userId,
        eventType: AuditEventType.TWO_FACTOR_ENABLED,
        metadata: { method: setup.method, ipAddress },
        success: true
      })

      return {
        success: true,
        message: 'Two-factor authentication enabled successfully'
      }
    } catch (error) {
      console.error('2FA verification error:', error)
      return {
        success: false,
        message: 'Failed to verify two-factor authentication'
      }
    }
  }

  /**
   * Verify 2FA code during login
   */
  static async verifyCode(
    userId: string,
    code: string,
    trustDevice: boolean = false,
    ipAddress?: string
  ): Promise<{
    success: boolean
    trustedToken?: string
    message?: string
  }> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          twoFactorEnabled: true,
          twoFactorMethod: true,
          twoFactorSecret: true,
          twoFactorBackupCodes: true,
          email: true
        }
      })

      if (!user?.twoFactorEnabled) {
        return {
          success: true,
          message: 'Two-factor not enabled'
        }
      }

      let verified = false

      // First check if it's a backup code
      if (user.twoFactorBackupCodes && code.length === 10) {
        const hashedCode = await this.hashBackupCode(code)
        const backupCodes = user.twoFactorBackupCodes as string[]
        
        if (backupCodes.includes(hashedCode)) {
          // Remove used backup code
          const updatedCodes = backupCodes.filter(c => c !== hashedCode)
          await prisma.user.update({
            where: { id: userId },
            data: { twoFactorBackupCodes: updatedCodes }
          })
          verified = true
        }
      }

      // If not a backup code, verify based on method
      if (!verified) {
        switch (user.twoFactorMethod) {
          case TwoFactorMethod.TOTP:
            if (user.twoFactorSecret) {
              verified = speakeasy.totp.verify({
                secret: user.twoFactorSecret,
                encoding: 'base32',
                token: code,
                window: 2
              })
            }
            break
          case TwoFactorMethod.EMAIL: {
            const storedCode = await redis.get(`2fa-email-code:${userId}`)
            verified = storedCode === code
            if (verified) {
              await redis.del(`2fa-email-code:${userId}`)
            }
            break
          }
          case TwoFactorMethod.SMS:
            // TODO: Implement SMS verification
            break
        }
      }

      if (!verified) {
        // Track failed attempts
        await AuditLogger.log({
          userId,
          eventType: AuditEventType.TWO_FACTOR_FAILED,
          metadata: { method: user.twoFactorMethod, ipAddress },
          success: false
        })

        return {
          success: false,
          message: 'Invalid verification code'
        }
      }

      // Generate trusted device token if requested
      let trustedToken: string | undefined
      if (trustDevice) {
        trustedToken = randomBytes(32).toString('hex')
        await redis.setex(
          `trusted-device:${trustedToken}`,
          30 * 24 * 60 * 60, // 30 days
          userId
        )
      }

      // Log successful 2FA verification
      await AuditLogger.log({
        userId,
        eventType: AuditEventType.TWO_FACTOR_VERIFIED,
        metadata: { 
          method: user.twoFactorMethod, 
          trustDevice,
          ipAddress 
        },
        success: true
      })

      return {
        success: true,
        ...(trustedToken && { trustedToken }),
        message: 'Two-factor authentication verified'
      }
    } catch (error) {
      console.error('2FA code verification error:', error)
      return {
        success: false,
        message: 'Failed to verify code'
      }
    }
  }

  /**
   * Send 2FA code for email method
   */
  static async sendEmailCode(userId: string): Promise<{
    success: boolean
    message?: string
  }> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          email: true,
          twoFactorMethod: true,
          twoFactorEnabled: true
        }
      })

      if (!user || !user.twoFactorEnabled || user.twoFactorMethod !== TwoFactorMethod.EMAIL) {
        return {
          success: false,
          message: 'Email two-factor not enabled'
        }
      }

      // Check rate limiting
      const rateLimitKey = `2fa-email-rate:${userId}`
      const attempts = await redis.incr(rateLimitKey)
      
      if (attempts === 1) {
        await redis.expire(rateLimitKey, 60 * 60) // 1 hour
      }
      
      if (attempts > 5) {
        return {
          success: false,
          message: 'Too many code requests. Please try again later.'
        }
      }

      // Generate and send code
      const code = this.generateNumericCode()
      
      await redis.setex(
        `2fa-email-code:${userId}`,
        this.CODE_EXPIRY,
        code
      )

      const emailResult = await EmailService.sendTwoFactorCode(user.email, code)
      
      return {
        success: emailResult.success,
        message: emailResult.success 
          ? 'Verification code sent to your email'
          : 'Failed to send verification code'
      }
    } catch (error) {
      console.error('Send email code error:', error)
      return {
        success: false,
        message: 'Failed to send verification code'
      }
    }
  }

  /**
   * Disable two-factor authentication
   */
  static async disableTwoFactor(
    userId: string,
    password: string,
    ipAddress?: string
  ): Promise<{
    success: boolean
    message?: string
  }> {
    try {
      // Verify password before disabling 2FA
      const bcrypt = await import('bcrypt')
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { password: true, email: true }
      })

      if (!user) {
        return {
          success: false,
          message: 'User not found'
        }
      }

      const validPassword = await bcrypt.default.compare(password, user.password)
      if (!validPassword) {
        await AuditLogger.log({
          userId,
          email: user.email,
          eventType: AuditEventType.TWO_FACTOR_DISABLED,
          metadata: { reason: 'Invalid password', ipAddress },
          success: false
        })

        return {
          success: false,
          message: 'Invalid password'
        }
      }

      // Disable 2FA
      await prisma.user.update({
        where: { id: userId },
        data: {
          twoFactorEnabled: false,
          twoFactorMethod: null,
          twoFactorSecret: null,
          twoFactorBackupCodes: Prisma.JsonNull, // Use Prisma.JsonNull for JSON fields
          twoFactorPhoneNumber: null
        }
      })

      // Log successful 2FA disable
      await AuditLogger.log({
        userId,
        email: user.email,
        eventType: AuditEventType.TWO_FACTOR_DISABLED,
        metadata: { ipAddress },
        success: true
      })

      return {
        success: true,
        message: 'Two-factor authentication disabled'
      }
    } catch (error) {
      console.error('Disable 2FA error:', error)
      return {
        success: false,
        message: 'Failed to disable two-factor authentication'
      }
    }
  }

  /**
   * Generate backup codes
   */
  private static generateBackupCodes(): string[] {
    const codes: string[] = []
    for (let i = 0; i < this.BACKUP_CODE_COUNT; i++) {
      // Generate 10-character alphanumeric codes
      const code = randomBytes(5).toString('hex').toUpperCase()
      codes.push(code)
    }
    return codes
  }

  /**
   * Hash backup code for storage
   */
  private static async hashBackupCode(code: string): Promise<string> {
    const crypto = await import('crypto')
    return crypto.default
      .createHash('sha256')
      .update(code.toUpperCase())
      .digest('hex')
  }

  /**
   * Generate numeric verification code
   */
  private static generateNumericCode(): string {
    // Use crypto.randomBytes for cryptographically secure random numbers
    const bytes = randomBytes(4)
    const code = (bytes.readUInt32BE(0) % 900000) + 100000
    return code.toString()
  }

  /**
   * Check if device is trusted
   */
  static async isTrustedDevice(token: string): Promise<string | null> {
    if (!token) return null
    
    const userId = await redis.get(`trusted-device:${token}`)
    return userId
  }

  /**
   * Regenerate backup codes
   */
  static async regenerateBackupCodes(
    userId: string,
    password: string
  ): Promise<{
    success: boolean
    backupCodes?: string[]
    message?: string
  }> {
    try {
      // Verify password
      const bcrypt = await import('bcrypt')
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { 
          password: true, 
          twoFactorEnabled: true 
        }
      })

      if (!user || !user.twoFactorEnabled) {
        return {
          success: false,
          message: 'Two-factor authentication not enabled'
        }
      }

      const validPassword = await bcrypt.default.compare(password, user.password)
      if (!validPassword) {
        return {
          success: false,
          message: 'Invalid password'
        }
      }

      // Generate new backup codes
      const backupCodes = this.generateBackupCodes()
      const hashedBackupCodes = await Promise.all(
        backupCodes.map(code => this.hashBackupCode(code))
      )

      // Update user
      await prisma.user.update({
        where: { id: userId },
        data: { twoFactorBackupCodes: hashedBackupCodes }
      })

      return {
        success: true,
        backupCodes,
        message: 'Backup codes regenerated successfully'
      }
    } catch (error) {
      console.error('Regenerate backup codes error:', error)
      return {
        success: false,
        message: 'Failed to regenerate backup codes'
      }
    }
  }
}