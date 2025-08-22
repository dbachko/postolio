import { FastifyPluginAsync } from 'fastify'
import { PasswordResetService } from '../services/password-reset.js'
import { validateAndSanitize } from '../middleware/validation.js'
import { passwordResetRequestSchema, passwordResetSchema } from '../schemas/auth.js'
import { enhancedRateLimiters } from '../services/enhanced-rate-limiter.js'

const passwordResetRoutes: FastifyPluginAsync = async (fastify) => {
  // Request password reset
  fastify.post<{ Body: { email: string } }>('/password/reset-request', {
    preHandler: [
      validateAndSanitize(passwordResetRequestSchema),
      enhancedRateLimiters.passwordReset()
    ]
  }, async (request, reply) => {
    const { email } = request.body
    const ipAddress = request.ip

    const result = await PasswordResetService.requestReset(email, ipAddress)

    if (!result.success) {
      return reply.code(400).send({ error: result.message })
    }

    return reply.send({
      success: true,
      message: result.message
    })
  })

  // Reset password with token
  fastify.post<{ Body: { token: string; password: string; confirmPassword: string } }>('/password/reset', {
    preHandler: validateAndSanitize(passwordResetSchema)
  }, async (request, reply) => {
    const { token, password } = request.body
    const ipAddress = request.ip

    const result = await PasswordResetService.resetPassword(token, password, ipAddress)

    if (!result.success) {
      return reply.code(400).send({ error: result.message })
    }

    // Optionally auto-login after password reset
    if (result.userId) {
      // You could generate a JWT token here and log them in
      // For now, we'll just return success
    }

    return reply.send({
      success: true,
      message: result.message
    })
  })

  // Validate reset token
  fastify.get<{ Params: { token: string } }>('/password/reset-validate/:token', async (request, reply) => {
    const { token } = request.params

    if (!token || typeof token !== 'string' || token.length !== 32) {
      return reply.code(400).send({ 
        valid: false,
        message: 'Invalid token format'
      })
    }

    const result = await PasswordResetService.validateToken(token)

    return reply.send({
      valid: result.valid,
      email: result.email ? result.email.replace(/^(.{2}).*(@.*)$/, '$1***$2') : undefined
    })
  })

  // Check if password reset is configured
  fastify.get('/password/reset-status', async (request, reply) => {
    return reply.send({
      configured: PasswordResetService.isConfigured(),
      message: PasswordResetService.isConfigured()
        ? 'Password reset is available'
        : 'Password reset requires email configuration'
    })
  })
}

export default passwordResetRoutes