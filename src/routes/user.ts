import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { TimezoneService } from '../services/timezone.js'

const prisma = new PrismaClient()

const userRoutes: FastifyPluginAsync = async (fastify, opts) => {
  // Update user timezone preferences
  fastify.patch('/api/users/timezone', {
    preHandler: fastify.authenticate,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // After authenticate middleware, user is guaranteed to exist
    const userId = (request as any).user.id
    const { timezone, timezoneAutoDetected } = request.body as {
      timezone: string
      timezoneAutoDetected: boolean
    }
    
    // Validate timezone if not auto-detected
    if (!timezoneAutoDetected && !TimezoneService.isValidTimezone(timezone)) {
      return reply.status(400).send({ error: 'Invalid timezone' })
    }
    
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        timezone: timezoneAutoDetected ? null : timezone,
        timezoneAutoDetected,
      },
      select: {
        id: true,
        timezone: true,
        timezoneAutoDetected: true,
      }
    })
    
    return { success: true, user: updatedUser }
  })

  // Get brand timezone
  fastify.get('/api/brands/:brandId/timezone', {
    preHandler: fastify.authenticate,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // After authenticate middleware, user is guaranteed to exist
    const userId = (request as any).user.id
    const { brandId } = request.params as { brandId: string }
    
    // Verify brand ownership
    const brand = await prisma.brand.findFirst({
      where: {
        id: brandId,
        userId,
      },
      select: {
        postingTimezone: true,
      }
    })
    
    if (!brand) {
      return reply.status(404).send({ error: 'Brand not found or access denied' })
    }
    
    return { timezone: brand.postingTimezone }
  })

  // Update brand timezone
  fastify.patch('/api/brands/:brandId/timezone', {
    preHandler: fastify.authenticate,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // After authenticate middleware, user is guaranteed to exist
    const userId = (request as any).user.id
    const { brandId } = request.params as { brandId: string }
    const { timezone } = request.body as { timezone: string | null }
    
    // Verify brand ownership
    const brand = await prisma.brand.findFirst({
      where: {
        id: brandId,
        userId,
      }
    })
    
    if (!brand) {
      return reply.status(404).send({ error: 'Brand not found or access denied' })
    }
    
    // Validate timezone if provided
    if (timezone && !TimezoneService.isValidTimezone(timezone)) {
      return reply.status(400).send({ error: 'Invalid timezone' })
    }
    
    const updatedBrand = await prisma.brand.update({
      where: { id: brandId },
      data: {
        postingTimezone: timezone,
      },
      select: {
        id: true,
        postingTimezone: true,
      }
    })
    
    return { success: true, brand: updatedBrand }
  })
}

export default userRoutes