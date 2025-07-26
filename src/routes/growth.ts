import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { verifyJWT } from '../services/jwt.js'
import growthService from '../services/growth.js'

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

interface AnalyzeRequest extends FastifyRequest {
  body: {
    brandId: string
  }
}

interface StrategiesRequest extends FastifyRequest {
  body: {
    brandId: string
    focus?: string
  }
}

interface MetricsRequest extends FastifyRequest {
  params: {
    brandId: string
  }
  query: {
    period?: string
  }
}

export default async function growthRoutes(fastify: FastifyInstance) {
  // Analyze growth opportunities
  fastify.post('/analyze', async function (request: AnalyzeRequest, reply: FastifyReply) {
    const user = authenticateRequest(request, reply)
    if (!user) return

    try {
      const { brandId } = request.body

      if (!brandId) {
        return reply.code(400).send({ error: 'Brand ID is required' })
      }

      const analysis = await growthService.analyzeGrowthOpportunities(brandId)
      
      reply.send({
        success: true,
        analysis
      })
    } catch (error) {
      console.error('Growth analysis error:', error)
      reply.code(500).send({ error: 'Failed to analyze growth opportunities' })
    }
  })

  // Generate growth strategies
  fastify.post('/strategies', async function (request: StrategiesRequest, reply: FastifyReply) {
    const user = authenticateRequest(request, reply)
    if (!user) return

    try {
      const { brandId, focus } = request.body

      if (!brandId) {
        return reply.code(400).send({ error: 'Brand ID is required' })
      }

      const strategies = await growthService.generateGrowthStrategies(brandId, focus)
      
      reply.send({
        success: true,
        strategies
      })
    } catch (error) {
      console.error('Growth strategies error:', error)
      reply.code(500).send({ error: 'Failed to generate growth strategies' })
    }
  })

  // Get growth metrics
  fastify.get('/metrics/:brandId', async function (request: MetricsRequest, reply: FastifyReply) {
    const user = authenticateRequest(request, reply)
    if (!user) return

    try {
      const { brandId } = request.params
      const period = parseInt(request.query.period || '30')

      const metrics = await growthService.getGrowthMetrics(brandId, period)
      
      reply.send({
        success: true,
        metrics
      })
    } catch (error) {
      console.error('Growth metrics error:', error)
      reply.code(500).send({ error: 'Failed to get growth metrics' })
    }
  })
}