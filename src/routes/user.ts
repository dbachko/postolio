import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { getDatabaseClient } from '../config/database.js'
import { TimezoneService } from '../services/timezone.js'

const prisma = getDatabaseClient()

// Validation helpers
function validateTimezoneUpdate(body: unknown): { timezone: string; timezoneAutoDetected: boolean } | null {
  if (!body || typeof body !== 'object') return null
  
  const { timezone, timezoneAutoDetected } = body as any
  
  if (typeof timezone !== 'string' || typeof timezoneAutoDetected !== 'boolean') {
    return null
  }
  
  return { timezone, timezoneAutoDetected }
}

function validateBrandTimezoneUpdate(body: unknown): { timezone: string | null } | null {
  if (!body || typeof body !== 'object') return null
  
  const { timezone } = body as any
  
  if (timezone !== null && typeof timezone !== 'string') {
    return null
  }
  
  return { timezone }
}

const userRoutes: FastifyPluginAsync = async (fastify, opts) => {
  // Update user timezone preferences
  fastify.patch('/api/users/timezone', {
    preHandler: fastify.authenticate,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // After authenticate middleware, user is guaranteed to exist
    const userId = (request as any).user.id
    
    // Validate request body
    const validatedData = validateTimezoneUpdate(request.body)
    if (!validatedData) {
      return reply.status(400).send({ 
        error: 'Invalid request body. Expected { timezone: string, timezoneAutoDetected: boolean }' 
      })
    }
    
    const { timezone, timezoneAutoDetected } = validatedData
    
    // Validate timezone if not auto-detected
    if (!timezoneAutoDetected && !TimezoneService.isValidTimezone(timezone)) {
      return reply.status(400).send({ error: 'Invalid timezone' })
    }
    
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        timezone: timezone, // Store the actual timezone value even when auto-detected
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
    
    // Validate request body
    const validatedData = validateBrandTimezoneUpdate(request.body)
    if (!validatedData) {
      return reply.status(400).send({ 
        error: 'Invalid request body. Expected { timezone: string | null }' 
      })
    }
    
    const { timezone } = validatedData
    
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