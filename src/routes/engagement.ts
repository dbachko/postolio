import { FastifyPluginAsync } from 'fastify'

import { verifyJWT } from '../services/jwt.js'
import { engagementService, type EngagementRules } from '../services/engagement.js'

import { getDatabaseClient } from '../config/database.js'

const prisma = getDatabaseClient()

// Helper function to verify authentication
function authenticateRequest(request: any, reply: any) {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    reply.status(401).send({ error: 'Authorization header required' })
    return null
  }

  const token = authHeader.substring(7)
  try {
    return verifyJWT(token)
  } catch (error) {
    reply.status(401).send({ error: 'Invalid token' })
    return null
  }
}

const engagement: FastifyPluginAsync = async function (fastify) {
  // Create or update engagement rules
  fastify.post('/rules', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { brandId, rules } = request.body as {
        brandId: string
        rules: Omit<EngagementRules, 'brandId'>
      }

      if (!brandId || !rules) {
        return reply.status(400).send({ error: 'brandId and rules are required' })
      }

      const userId = user.id

      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: userId,
        },
      })

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found' })
      }

      // Set default safety limits if not provided
      const engagementRules: EngagementRules = {
        brandId,
        ...rules,
        safetyLimits: {
          maxActionsPerHour: rules.safetyLimits?.maxActionsPerHour ?? 50,
          minDelayBetweenActions: rules.safetyLimits?.minDelayBetweenActions ?? 60,
          respectBusinessHours: rules.safetyLimits?.respectBusinessHours ?? true,
        },
      }

      const savedRules = await engagementService.setEngagementRules(engagementRules)

      reply.status(201).send({
        success: true,
        rules: savedRules,
      })
    } catch (error) {
      reply.status(400).send({
        error: 'Failed to create engagement rules',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  // Get engagement rules for a brand
  fastify.get('/rules/:brandId', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { brandId } = request.params as { brandId: string }
      const userId = user.id

      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: userId,
        },
      })

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found' })
      }

      const rules = await engagementService.getEngagementRules(brandId)

      if (!rules) {
        return reply.send({
          rules: null,
          message: 'No engagement rules configured',
        })
      }

      reply.send({ rules })
    } catch (error) {
      reply.status(500).send({
        error: 'Failed to get engagement rules',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  // Update engagement rules
  fastify.put('/rules/:brandId', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { brandId } = request.params as { brandId: string }
      const { rules } = request.body as { rules: Omit<EngagementRules, 'brandId'> }

      if (!rules) {
        return reply.status(400).send({ error: 'rules are required' })
      }

      const userId = user.id

      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: userId,
        },
      })

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found' })
      }

      const engagementRules: EngagementRules = {
        brandId,
        ...rules,
      }

      const updatedRules = await engagementService.setEngagementRules(engagementRules)

      reply.send({
        success: true,
        rules: updatedRules,
      })
    } catch (error) {
      reply.status(400).send({
        error: 'Failed to update engagement rules',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  // Delete engagement rules
  fastify.delete('/rules/:brandId', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { brandId } = request.params as { brandId: string }
      const userId = user.id

      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: userId,
        },
      })

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found' })
      }

      // Remove engagement rules
      await prisma.brand.update({
        where: { id: brandId },
        data: {
          engagementRules: { set: null },
        },
      })

      reply.send({ success: true })
    } catch (error) {
      reply.status(500).send({
        error: 'Failed to delete engagement rules',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  // Get engagement statistics
  fastify.get('/stats/:brandId', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { brandId } = request.params as { brandId: string }
      const { days = 7 } = request.query as { days?: number }
      const userId = user.id

      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: userId,
        },
      })

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found' })
      }

      const stats = await engagementService.getEngagementStats(brandId, days)

      reply.send({ stats })
    } catch (error) {
      reply.status(500).send({
        error: 'Failed to get engagement statistics',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  // Start engagement automation for a brand
  fastify.post('/start/:brandId', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { brandId } = request.params as { brandId: string }
      const userId = user.id

      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: userId,
        },
      })

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found' })
      }

      // Check if engagement rules exist
      const rules = await engagementService.getEngagementRules(brandId)
      if (!rules) {
        return reply.status(400).send({ error: 'No engagement rules configured' })
      }

      // Check if Instagram is connected
      if (!brand.instagramAccessToken) {
        return reply.status(400).send({ error: 'Instagram account not connected' })
      }

      // Mark engagement as active
      await prisma.brand.update({
        where: { id: brandId },
        data: {
          engagementActive: true,
        },
      })

      reply.send({
        success: true,
        message: 'Engagement automation started',
      })
    } catch (error) {
      reply.status(500).send({
        error: 'Failed to start engagement automation',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  // Stop engagement automation for a brand
  fastify.post('/stop/:brandId', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { brandId } = request.params as { brandId: string }
      const userId = user.id

      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: userId,
        },
      })

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found' })
      }

      // Mark engagement as inactive
      await prisma.brand.update({
        where: { id: brandId },
        data: {
          engagementActive: false,
        },
      })

      reply.send({
        success: true,
        message: 'Engagement automation stopped',
      })
    } catch (error) {
      reply.status(500).send({
        error: 'Failed to stop engagement automation',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  // Get engagement status for a brand
  fastify.get('/status/:brandId', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { brandId } = request.params as { brandId: string }
      const userId = user.id

      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: userId,
        },
      })

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found' })
      }

      const rules = await engagementService.getEngagementRules(brandId)
      const hasInstagram = !!brand.instagramAccessToken
      const isActive = brand.engagementActive || false

      reply.send({
        status: {
          configured: !!rules,
          active: isActive,
          instagramConnected: hasInstagram,
          canStart: !!rules && hasInstagram && !isActive,
          canStop: isActive,
        },
      })
    } catch (error) {
      reply.status(500).send({
        error: 'Failed to get engagement status',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })
}

export default engagement
