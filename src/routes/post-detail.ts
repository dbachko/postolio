import { FastifyPluginAsync } from 'fastify'
import { getDatabaseClient } from '../config/database.js'
import { authenticateRequest } from '../middleware/auth.js'
import { instagramService } from '../services/instagram.js'

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
    const userId = request.user!.id // User is guaranteed by middleware

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
    const userId = request.user!.id // User is guaranteed by middleware

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

      // Initialize default metrics
      let metrics = {
        impressions: 0,
        reach: 0,
        engagement: 0,
        saves: 0,
        shares: 0,
        comments_count: 0,
        likes_count: 0
      }

      // If post is published and has Instagram ID, fetch real metrics
      if (post.status === 'published' && post.instagramPostId && post.brand) {
        try {
          const insightsResponse = await instagramService.getMediaInsights(post.brand, post.instagramPostId)
          
          // Parse Instagram insights data
          if (insightsResponse?.data) {
            const insights = insightsResponse.data
            metrics = {
              impressions: insights.find((m: any) => m.name === 'impressions')?.values?.[0]?.value || 0,
              reach: insights.find((m: any) => m.name === 'reach')?.values?.[0]?.value || 0,
              engagement: insights.find((m: any) => m.name === 'engagement')?.values?.[0]?.value || 0,
              saves: insights.find((m: any) => m.name === 'saves')?.values?.[0]?.value || 0,
              shares: insights.find((m: any) => m.name === 'shares')?.values?.[0]?.value || 0,
              comments_count: insights.find((m: any) => m.name === 'comments')?.values?.[0]?.value || 0,
              likes_count: insights.find((m: any) => m.name === 'likes')?.values?.[0]?.value || 0
            }
          }
        } catch (error) {
          console.error('Failed to fetch Instagram metrics:', error)
          // Return default metrics on error
        }
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
    const userId = request.user!.id // User is guaranteed by middleware

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

      // Initialize default values
      let comments: any[] = []
      let total = 0

      // If post is published and has Instagram ID, fetch real comments
      if (post.status === 'published' && post.instagramPostId && post.brand) {
        try {
          const commentsResponse = await instagramService.getPostComments(
            post.brand,
            post.instagramPostId,
            Number(limit)
          )
          comments = commentsResponse.data
          total = commentsResponse.total
        } catch (error) {
          console.error('Failed to fetch Instagram comments:', error)
          // Return empty comments on error
        }
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