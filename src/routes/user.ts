import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { getDatabaseClient } from '../config/database.js'
import { TimezoneService } from '../services/timezone.js'
import { verifyJWT } from '../services/jwt.js'

const prisma = getDatabaseClient()

// Helper function to verify authentication and extract user ID
async function authenticateRequest(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  const authHeader = request.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Authentication required' })
    return null
  }
  
  try {
    const token = authHeader.substring(7)
    const decoded = verifyJWT(token)
    return decoded.id
  } catch (err: any) {
    // Check if the error is an authentication error
    if (
      err?.name === 'JsonWebTokenError' ||
      err?.name === 'TokenExpiredError' ||
      err?.message?.toLowerCase().includes('jwt') ||
      err?.message?.toLowerCase().includes('auth') ||
      err?.message?.toLowerCase().includes('token')
    ) {
      reply.code(401).send({ error: 'Authentication required' })
    } else {
      // Log error for debugging
      request.log.error({ err }, 'Authentication verification failed')
      reply.code(500).send({ error: 'Internal server error' })
    }
    return null
  }
}

// Type guards for proper input validation
function isTimezoneUpdateBody(body: unknown): body is { timezone: string; timezoneAutoDetected: boolean } {
  if (!body || typeof body !== 'object') return false
  
  const obj = body as Record<string, unknown>
  
  return typeof obj.timezone === 'string' && typeof obj.timezoneAutoDetected === 'boolean'
}

function isBrandTimezoneUpdateBody(body: unknown): body is { timezone: string | null } {
  if (!body || typeof body !== 'object') return false
  
  const obj = body as Record<string, unknown>
  
  return obj.timezone === null || typeof obj.timezone === 'string'
}

// Validation helpers using type guards
function validateTimezoneUpdate(body: unknown): { timezone: string; timezoneAutoDetected: boolean } | null {
  if (isTimezoneUpdateBody(body)) {
    return body
  }
  return null
}

function validateBrandTimezoneUpdate(body: unknown): { timezone: string | null } | null {
  if (isBrandTimezoneUpdateBody(body)) {
    return body
  }
  return null
}

const userRoutes: FastifyPluginAsync = async (fastify) => {
  // Update user timezone preferences
  fastify.patch('/api/users/timezone', async (request: FastifyRequest, reply: FastifyReply) => {
    // Verify authentication
    const userId = await authenticateRequest(request, reply)
    if (!userId) return
    
    try {
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
    } catch (err: any) {
      // Log error for debugging
      request.log.error({ err }, 'Failed to update user timezone')
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Get brand timezone
  fastify.get('/api/brands/:brandId/timezone', async (request: FastifyRequest, reply: FastifyReply) => {
    // Verify authentication
    const userId = await authenticateRequest(request, reply)
    if (!userId) return
    
    try {
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
    } catch (err: any) {
      // Log error for debugging
      request.log.error({ err }, 'Failed to get brand timezone')
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Update brand timezone
  fastify.patch('/api/brands/:brandId/timezone', async (request: FastifyRequest, reply: FastifyReply) => {
    // Verify authentication
    const userId = await authenticateRequest(request, reply)
    if (!userId) return
    
    try {
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
    } catch (err: any) {
      // Log error for debugging
      request.log.error({ err }, 'Failed to update brand timezone')
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })
}

export default userRoutes