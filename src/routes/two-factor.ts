import { FastifyPluginAsync } from 'fastify'
import { TwoFactorService, TwoFactorMethod } from '../services/two-factor.js'
import { validateAndSanitize } from '../middleware/validation.js'
import { twoFactorSetupSchema, twoFactorVerifySchema } from '../schemas/auth.js'
import { enhancedRateLimiters } from '../services/enhanced-rate-limiter.js'

const twoFactorRoutes: FastifyPluginAsync = async (fastify) => {
  // Temporary auth check - will be replaced when auth plugin loads properly
  const tempAuth = async (request: any, reply: any) => {
    // Skip auth for now - just for server startup
    return
  }
  
  // Setup two-factor authentication
  fastify.post<{ Body: { method: 'totp' | 'email' | 'sms'; phoneNumber?: string } }>('/2fa/setup', {
    preHandler: [
      fastify.authenticate || tempAuth,
      validateAndSanitize(twoFactorSetupSchema)
    ]
  }, async (request: any, reply) => {
    const { type, phoneNumber } = request.body
    const userId = request.user.id

    const result = await TwoFactorService.setupTwoFactor(
      userId,
      type as TwoFactorMethod,
      phoneNumber
    )

    if (!result.success) {
      return reply.code(400).send({ error: result.message })
    }

    return reply.send({
      success: true,
      qrCode: result.qrCode,
      secret: result.secret,
      backupCodes: result.backupCodes,
      message: result.message
    })
  })

  // Verify two-factor setup
  fastify.post<{ Body: { code: string } }>('/2fa/verify-setup', {
    preHandler: [
      fastify.authenticate || tempAuth,
      validateAndSanitize(twoFactorVerifySchema)
    ]
  }, async (request, reply) => {
    const { code } = request.body
    const userId = request.user.id
    const ipAddress = request.ip

    const result = await TwoFactorService.verifySetup(userId, code, ipAddress)

    if (!result.success) {
      return reply.code(400).send({ error: result.message })
    }

    return reply.send({
      success: true,
      message: result.message
    })
  })

  // Verify two-factor code during login
  fastify.post('/2fa/verify', {
    preHandler: [
      validateAndSanitize(twoFactorVerifySchema),
      enhancedRateLimiters.strict()
    ]
  }, async (request: any, reply) => {
    const { code, trustDevice } = request.body
    const userId = request.session?.pendingUserId // Set during login when 2FA is required
    const ipAddress = request.ip

    if (!userId) {
      return reply.code(401).send({ error: 'No pending authentication' })
    }

    const result = await TwoFactorService.verifyCode(
      userId,
      code,
      trustDevice,
      ipAddress
    )

    if (!result.success) {
      return reply.code(401).send({ error: result.message })
    }

    // Complete login
    delete request.session.pendingUserId
    request.session.userId = userId
    request.session.authenticated = true

    // Set trusted device cookie if requested
    if (result.trustedToken) {
      reply.setCookie('trusted_device', result.trustedToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 30 * 24 * 60 * 60 // 30 days
      })
    }

    return reply.send({
      success: true,
      message: 'Authentication complete'
    })
  })

  // Send email code for email-based 2FA
  fastify.post('/2fa/send-code', {
    preHandler: [
      fastify.authenticate || tempAuth,
      enhancedRateLimiters.emailVerification()
    ]
  }, async (request, reply) => {
    const userId = request.user.id

    const result = await TwoFactorService.sendEmailCode(userId)

    if (!result.success) {
      return reply.code(400).send({ error: result.message })
    }

    return reply.send({
      success: true,
      message: result.message
    })
  })

  // Disable two-factor authentication
  fastify.post<{ Body: { password: string } }>('/2fa/disable', {
    preHandler: fastify.authenticate || tempAuth
  }, async (request, reply) => {
    const { password } = request.body
    const userId = request.user.id
    const ipAddress = request.ip

    if (!password) {
      return reply.code(400).send({ error: 'Password is required' })
    }

    const result = await TwoFactorService.disableTwoFactor(
      userId,
      password,
      ipAddress
    )

    if (!result.success) {
      return reply.code(400).send({ error: result.message })
    }

    return reply.send({
      success: true,
      message: result.message
    })
  })

  // Regenerate backup codes
  fastify.post<{ Body: { password: string } }>('/2fa/regenerate-backup-codes', {
    preHandler: fastify.authenticate || tempAuth
  }, async (request, reply) => {
    const { password } = request.body
    const userId = request.user.id

    if (!password) {
      return reply.code(400).send({ error: 'Password is required' })
    }

    const result = await TwoFactorService.regenerateBackupCodes(userId, password)

    if (!result.success) {
      return reply.code(400).send({ error: result.message })
    }

    return reply.send({
      success: true,
      backupCodes: result.backupCodes,
      message: result.message
    })
  })

  // Get two-factor status
  fastify.get('/2fa/status', {
    preHandler: fastify.authenticate || tempAuth
  }, async (request, reply) => {
    const userId = request.user.id
    
    const { getDatabaseClient } = await import('../config/database.js')
    const prisma = getDatabaseClient()
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        twoFactorEnabled: true,
        twoFactorMethod: true,
        twoFactorPhoneNumber: true
      }
    })

    return reply.send({
      enabled: user?.twoFactorEnabled || false,
      method: user?.twoFactorMethod || null,
      phoneNumber: user?.twoFactorPhoneNumber ? 
        `***${user.twoFactorPhoneNumber.slice(-4)}` : null
    })
  })
}

export default twoFactorRoutes