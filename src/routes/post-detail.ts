import { FastifyPluginAsync } from 'fastify'
import { getDatabaseClient } from '../config/database.js'
import { authenticateRequest } from '../middleware/auth.js'

const prisma = getDatabaseClient()

interface PostDetailParams {
  postId: string
}

const postDetailRoutes: FastifyPluginAsync = async (app) => {
  // Add authentication middleware to all routes
  app.addHook('preHandler', authenticateRequest)
  
  // Get comprehensive post detail
  app.get<{ Params: PostDetailParams }>('/api/posts/:postId/detail', async (request, reply) => {
    const { postId } = request.params
    const userId = (request as any).user.id // User is guaranteed by middleware

    try {
      // Fetch post with all relations
      const post = await prisma.content.findUnique({
        where: { id: postId },
        include: {
          brand: true,
          campaign: true
        }
      })

      if (!post) {
        return reply.code(404).send({
          success: false,
          error: 'Post not found'
        })
      }

      // Check user has access to this post
      const hasAccess = await prisma.brand.findFirst({
        where: {
          id: post.brandId,
          userId: userId
        }
      })

      if (!hasAccess) {
        return reply.code(403).send({
          success: false,
          error: 'Access denied'
        })
      }

      return reply.send({
        success: true,
        data: post
      })
    } catch (error) {
      app.log.error('Error fetching post detail:', error)
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch post detail'
      })
    }
  })

  // Get Instagram insights for a post
  app.get<{ Params: PostDetailParams }>('/api/posts/:postId/insights', async (request, reply) => {
    const { postId } = request.params
    const userId = (request as any).user.id // User is guaranteed by middleware

    try {
      // Fetch post to check access
      const post = await prisma.content.findUnique({
        where: { id: postId },
        include: {
          brand: true
        }
      })

      if (!post) {
        return reply.code(404).send({
          success: false,
          error: 'Post not found'
        })
      }

      // Check user has access
      if (post.brand.userId !== userId) {
        return reply.code(403).send({
          success: false,
          error: 'Access denied'
        })
      }

      // TODO: Integrate with Instagram Graph API if post is published
      // For now, return mock metrics or empty metrics
      const metrics = {
        impressions: 0,
        reach: 0,
        engagement: 0,
        saves: 0,
        shares: 0,
        comments_count: 0,
        likes_count: 0
      }

      // If post is published and has Instagram ID, fetch real metrics
      if (post.status === 'published' && post.instagramPostId) {
        // TODO: Call Instagram Graph API
        // const instagramMetrics = await instagramService.getPostInsights(post.instagramPostId)
        // Object.assign(metrics, instagramMetrics)
      }

      return reply.send({
        success: true,
        data: {
          postId,
          metrics,
          lastUpdated: new Date().toISOString()
        }
      })
    } catch (error) {
      app.log.error('Error fetching post insights:', error)
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch post insights'
      })
    }
  })

  // Get comments for a post (mock for now, will integrate with Instagram later)
  app.get<{ Params: PostDetailParams }>('/api/posts/:postId/comments', async (request, reply) => {
    const { postId } = request.params
    const { page = 1, limit = 20 } = request.query as { page?: number; limit?: number }
    const userId = (request as any).user.id // User is guaranteed by middleware

    try {
      // Fetch post to check access
      const post = await prisma.content.findUnique({
        where: { id: postId },
        include: {
          brand: true
        }
      })

      if (!post) {
        return reply.code(404).send({
          success: false,
          error: 'Post not found'
        })
      }

      // Check user has access
      if (post.brand.userId !== userId) {
        return reply.code(403).send({
          success: false,
          error: 'Access denied'
        })
      }

      // TODO: Fetch real comments from Instagram if post is published
      const comments: any[] = []
      const total = 0

      // If post is published and has Instagram ID, fetch real comments
      if (post.status === 'published' && post.instagramPostId) {
        // TODO: Call Instagram Graph API
        // const instagramComments = await instagramService.getPostComments(post.instagramPostId, page, limit)
        // comments.push(...instagramComments.data)
        // total = instagramComments.total
      }

      return reply.send({
        success: true,
        data: {
          comments,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            pages: Math.ceil(total / Number(limit))
          }
        }
      })
    } catch (error) {
      app.log.error('Error fetching post comments:', error)
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch post comments'
      })
    }
  })
}

export default postDetailRoutes