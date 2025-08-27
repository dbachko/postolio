import { FastifyPluginAsync } from 'fastify'
import { getDatabaseClient } from '../config/database.js'
import { authenticateRequest } from '../middleware/auth.js'
import { instagramService } from '../services/instagram.js'
import { PostDetailParamsSchema, PaginationSchema, validateRequest } from '../schemas/api-validation.js'
import { successResponse, ErrorResponses, paginatedResponse } from '../utils/api-response.js'

const prisma = getDatabaseClient()

interface PostDetailParams {
  postId: string
}

const postDetailRoutes: FastifyPluginAsync = async (app) => {
  // Add authentication middleware to all routes
  app.addHook('preHandler', authenticateRequest)
  
  // Get comprehensive post detail
  app.get<{ Params: PostDetailParams }>('/api/posts/:postId/detail', async (request, reply) => {
    // Validate params
    const paramsValidation = validateRequest(PostDetailParamsSchema, request.params)
    if (!paramsValidation.success) {
      return reply.code(400).send(
        ErrorResponses.badRequest('Invalid request parameters', paramsValidation.errors)
      )
    }
    
    const { postId } = paramsValidation.data
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
        return reply.code(404).send(
          ErrorResponses.notFound('Post')
        )
      }

      // Check user has access to this post
      const hasAccess = await prisma.brand.findFirst({
        where: {
          id: post.brandId,
          userId: userId
        }
      })

      if (!hasAccess) {
        return reply.code(403).send(
          ErrorResponses.forbidden('Access denied to this post')
        )
      }

      return reply.send(successResponse(post))
    } catch (error) {
      app.log.error('Error fetching post detail:', error)
      return reply.code(500).send(
        ErrorResponses.internalError('Failed to fetch post detail')
      )
    }
  })

  // Get Instagram insights for a post
  app.get<{ Params: PostDetailParams }>('/api/posts/:postId/insights', async (request, reply) => {
    // Validate params
    const paramsValidation = validateRequest(PostDetailParamsSchema, request.params)
    if (!paramsValidation.success) {
      return reply.code(400).send(
        ErrorResponses.badRequest('Invalid request parameters', paramsValidation.errors)
      )
    }
    
    const { postId } = paramsValidation.data
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
        return reply.code(404).send(
          ErrorResponses.notFound('Post')
        )
      }

      // Check user has access
      if (post.brand.userId !== userId) {
        return reply.code(403).send(
          ErrorResponses.forbidden('Access denied to this post')
        )
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

      return reply.send(
        successResponse({
          postId,
          metrics,
          lastUpdated: new Date().toISOString()
        })
      )
    } catch (error) {
      app.log.error('Error fetching post insights:', error)
      return reply.code(500).send(
        ErrorResponses.internalError('Failed to fetch post insights')
      )
    }
  })

  // Get comments for a post
  app.get<{ Params: PostDetailParams }>('/api/posts/:postId/comments', async (request, reply) => {
    // Validate params
    const paramsValidation = validateRequest(PostDetailParamsSchema, request.params)
    if (!paramsValidation.success) {
      return reply.code(400).send(
        ErrorResponses.badRequest('Invalid request parameters', paramsValidation.errors)
      )
    }
    
    // Validate pagination
    const paginationResult = PaginationSchema.safeParse(request.query)
    if (!paginationResult.success) {
      const errors = paginationResult.error.issues.map(issue => {
        const path = issue.path.join('.')
        return path ? `${path}: ${issue.message}` : issue.message
      })
      return reply.code(400).send(
        ErrorResponses.badRequest('Invalid pagination parameters', errors)
      )
    }
    
    const { postId } = paramsValidation.data
    const { page, limit } = paginationResult.data
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
        return reply.code(404).send(
          ErrorResponses.notFound('Post')
        )
      }

      // Check user has access
      if (post.brand.userId !== userId) {
        return reply.code(403).send(
          ErrorResponses.forbidden('Access denied to this post')
        )
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

      return reply.send(
        paginatedResponse(
          comments,
          Number(page),
          Number(limit),
          total
        )
      )
    } catch (error) {
      app.log.error('Error fetching post comments:', error)
      return reply.code(500).send(
        ErrorResponses.internalError('Failed to fetch post comments')
      )
    }
  })
}

export default postDetailRoutes