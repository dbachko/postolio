import { FastifyInstance } from 'fastify'
import { verifyJWT } from '../services/jwt.js'
import aiService from '../services/ai-features.js'
import learningService from '../services/learning.js'

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

// Define body/params types for each route
interface HashtagOptimizeBody {
  brandId: string
  content: string
  currentHashtags: string[]
}

interface CompetitorAnalysisBody {
  brandId: string
  competitors: string[]
}

interface ContentSuggestionsBody {
  brandId: string
  context: string
  contentType: 'post' | 'story' | 'reel'
}

interface ScheduleOptimizeBody {
  brandId: string
}

interface ApplyLearningBody {
  brandId: string
  originalContent: {
    caption: string
    hashtags: string[]
    imageUrl?: string
    scheduledAt?: string
  }
  editedContent: {
    caption: string
    hashtags: string[]
    imageUrl?: string
    scheduledAt?: string
  }
}

interface LearningStatsParams {
  brandId: string
}

export default async function aiRoutes(fastify: FastifyInstance) {
  // Optimize hashtags with AI
  fastify.post<{ Body: HashtagOptimizeBody }>('/hashtags/optimize', async function (request, reply) {
    const user = authenticateRequest(request, reply)
    if (!user) return

    try {
      const { brandId, content, currentHashtags } = request.body

      if (!brandId || !content || !currentHashtags) {
        return reply.code(400).send({ error: 'Brand ID, content, and current hashtags are required' })
      }

      const optimization = await aiService.optimizeHashtags(brandId, content, currentHashtags)

      reply.send({
        success: true,
        ...optimization,
      })
    } catch (error) {
      console.error('Hashtag optimization error:', error)
      reply.code(500).send({ error: 'Failed to optimize hashtags' })
    }
  })

  // Analyze competitors
  fastify.post<{ Body: CompetitorAnalysisBody }>('/competitors/analyze', async function (request, reply) {
    const user = authenticateRequest(request, reply)
    if (!user) return

    try {
      const { brandId, competitors } = request.body

      if (!brandId || !competitors || !Array.isArray(competitors)) {
        return reply.code(400).send({ error: 'Brand ID and competitors array are required' })
      }

      const result = await aiService.analyzeCompetitors(brandId, competitors)

      reply.send({
        success: true,
        ...result,
      })
    } catch (error) {
      console.error('Competitor analysis error:', error)
      reply.code(500).send({ error: 'Failed to analyze competitors' })
    }
  })

  // Suggest content ideas
  fastify.post<{ Body: ContentSuggestionsBody }>('/content/suggestions', async function (request, reply) {
    const user = authenticateRequest(request, reply)
    if (!user) return

    try {
      const { brandId, context, contentType } = request.body

      if (!brandId || !context || !contentType) {
        return reply.code(400).send({ error: 'Brand ID, context, and content type are required' })
      }

      const result = await aiService.suggestContentIdeas(brandId, context, contentType)

      reply.send({
        success: true,
        ...result,
      })
    } catch (error) {
      console.error('Content suggestions error:', error)
      reply.code(500).send({ error: 'Failed to generate content suggestions' })
    }
  })

  // Optimize posting schedule
  fastify.post<{ Body: ScheduleOptimizeBody }>('/schedule/optimize', async function (request, reply) {
    const user = authenticateRequest(request, reply)
    if (!user) return

    try {
      const { brandId } = request.body

      if (!brandId) {
        return reply.code(400).send({ error: 'Brand ID is required' })
      }

      const result = await aiService.optimizeSchedule(brandId)

      reply.send({
        success: true,
        ...result,
      })
    } catch (error) {
      console.error('Schedule optimization error:', error)
      reply.code(500).send({ error: 'Failed to optimize schedule' })
    }
  })

  // Apply learning from user edits
  fastify.post<{ Body: ApplyLearningBody }>('/apply-learning', async function (request, reply) {
    const user = authenticateRequest(request, reply)
    if (!user) return

    try {
      const { brandId, originalContent, editedContent } = request.body

      if (!brandId || !originalContent || !editedContent) {
        return reply.code(400).send({ error: 'Brand ID, original content, and edited content are required' })
      }

      // Analyze the edit patterns
      const editAnalysis = await learningService.analyzeUserEdit(brandId, originalContent, editedContent)

      // Apply learning to style profile
      const results = await learningService.applyLearningToStyleProfile(brandId, editAnalysis)

      reply.send({
        success: true,
        insights: results.insights,
        profileUpdates: results.profileUpdates,
        appliedToFuturePosts: results.appliedToFuturePosts,
        message: `AI learned from your edits and applied insights to ${results.appliedToFuturePosts} future posts`,
      })
    } catch (error) {
      console.error('Learning application error:', error)
      reply.code(500).send({ error: 'Failed to apply learning from edits' })
    }
  })

  // Get learning analytics and stats
  fastify.get<{ Params: LearningStatsParams }>('/learning-stats/:brandId', async function (request, reply) {
    const user = authenticateRequest(request, reply)
    if (!user) return

    try {
      const { brandId } = request.params

      if (!brandId) {
        return reply.code(400).send({ error: 'Brand ID is required' })
      }

      const analytics = await learningService.getLearningAnalytics(brandId)

      reply.send({
        success: true,
        analytics,
      })
    } catch (error) {
      console.error('Learning analytics error:', error)
      reply.code(500).send({ error: 'Failed to retrieve learning analytics' })
    }
  })
}
