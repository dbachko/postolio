import { FastifyPluginAsync } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { verifyJWT } from '../services/jwt.js'
import { instagramService, mockInstagramService } from '../services/instagram.js'

const prisma = new PrismaClient()

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

const instagram: FastifyPluginAsync = async function (fastify) {
  // Get Instagram profile information
  fastify.get('/profile', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return
      
      const service = instagramService.isConfigured() ? instagramService : mockInstagramService
      const profile = await service.getProfile()
      
      reply.send({ profile })
    } catch (error) {
      reply.status(500).send({ 
        error: 'Failed to fetch Instagram profile',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // Get recent Instagram posts
  fastify.get('/posts', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { limit = 25 } = request.query as { limit?: number }
      const service = instagramService.isConfigured() ? instagramService : mockInstagramService
      const posts = await service.getRecentPosts(limit)
      
      reply.send({ posts })
    } catch (error) {
      reply.status(500).send({ 
        error: 'Failed to fetch Instagram posts',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // Connect Instagram account with brand
  fastify.post('/connect', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { brandId, accessToken, pageId } = request.body as {
        brandId: string
        accessToken: string
        pageId: string
      }

      if (!brandId || !accessToken || !pageId) {
        return reply.status(400).send({ 
          error: 'Missing required fields: brandId, accessToken, pageId' 
        })
      }

      const userId = user.userId

      // Verify brand belongs to user
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: userId
        }
      })

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found' })
      }

      // Test the Instagram connection
      const tempService = instagramService
      tempService.initializeClient(accessToken, pageId)
      
      try {
        const profile = await tempService.getProfile()
        
        // Update brand with Instagram connection details
        const updatedBrand = await prisma.brand.update({
          where: { id: brandId },
          data: {
            instagramHandle: `@${profile.username}`,
            instagramAccessToken: accessToken,
            instagramPageId: pageId,
            instagramProfileData: profile as any
          }
        })

        reply.send({ 
          success: true,
          brand: updatedBrand,
          profile 
        })
      } catch (connectionError) {
        reply.status(400).send({
          error: 'Invalid Instagram credentials',
          message: connectionError instanceof Error ? connectionError.message : 'Failed to connect'
        })
      }
    } catch (error) {
      reply.status(500).send({ 
        error: 'Failed to connect Instagram account',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // Publish content to Instagram
  fastify.post('/publish', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { contentId } = request.body as { contentId: string }

      if (!contentId) {
        return reply.status(400).send({ error: 'contentId is required' })
      }

      const userId = user.userId

      // Get content and verify ownership
      const content = await prisma.content.findFirst({
        where: {
          id: contentId,
          brand: {
            userId: userId
          }
        },
        include: {
          brand: true
        }
      })

      if (!content) {
        return reply.status(404).send({ error: 'Content not found' })
      }

      if (content.status !== 'approved') {
        return reply.status(400).send({ error: 'Content must be approved before publishing' })
      }

      // Check if brand has Instagram connection
      if (!content.brand.instagramAccessToken || !content.brand.instagramPageId) {
        return reply.status(400).send({ 
          error: 'Instagram account not connected to this brand' 
        })
      }

      // Initialize Instagram service for this brand
      const service = instagramService
      service.initializeClient(
        content.brand.instagramAccessToken, 
        content.brand.instagramPageId
      )

      // Validate image URL if present
      if (content.imageUrl) {
        const isValidImage = await service.validateImageUrl(content.imageUrl)
        if (!isValidImage) {
          return reply.status(400).send({ 
            error: 'Invalid or inaccessible image URL for Instagram posting' 
          })
        }
      }

      // Publish to Instagram
      const publishResult = await service.publishPost({
        imageUrl: content.imageUrl || 'https://via.placeholder.com/400?text=No+Image',
        caption: content.caption,
        hashtags: content.hashtags
      })

      // Update content status
      const updatedContent = await prisma.content.update({
        where: { id: contentId },
        data: {
          status: 'posted',
          postedAt: new Date(),
          instagramPostId: publishResult.id,
          instagramPermalink: publishResult.permalink
        }
      })

      reply.send({ 
        success: true,
        content: updatedContent,
        instagram: publishResult
      })
    } catch (error) {
      reply.status(500).send({ 
        error: 'Failed to publish to Instagram',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // Get Instagram insights for a post
  fastify.get('/insights/:postId', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { postId } = request.params as { postId: string }
      const userId = user.userId

      // Verify the post belongs to user's content
      const content = await prisma.content.findFirst({
        where: {
          instagramPostId: postId,
          brand: {
            userId: userId
          }
        },
        include: {
          brand: true
        }
      })

      if (!content) {
        return reply.status(404).send({ error: 'Post not found' })
      }

      // Check Instagram connection
      if (!content.brand.instagramAccessToken || !content.brand.instagramPageId) {
        return reply.status(400).send({ 
          error: 'Instagram account not connected' 
        })
      }

      // Get insights
      const service = instagramService.isConfigured() ? instagramService : mockInstagramService
      if (instagramService.isConfigured()) {
        instagramService.initializeClient(
          content.brand.instagramAccessToken,
          content.brand.instagramPageId
        )
      }
      
      const insights = await service.getPostInsights(postId)

      reply.send({ insights })
    } catch (error) {
      reply.status(500).send({ 
        error: 'Failed to fetch Instagram insights',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // Disconnect Instagram from brand
  fastify.post('/disconnect', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { brandId } = request.body as { brandId: string }

      if (!brandId) {
        return reply.status(400).send({ error: 'brandId is required' })
      }

      const userId = user.userId

      // Verify brand ownership and disconnect
      const updatedBrand = await prisma.brand.updateMany({
        where: {
          id: brandId,
          userId: userId
        },
        data: {
          instagramAccessToken: null,
          instagramPageId: null,
          instagramProfileData: null
        }
      })

      if (updatedBrand.count === 0) {
        return reply.status(404).send({ error: 'Brand not found' })
      }

      reply.send({ success: true })
    } catch (error) {
      reply.status(500).send({ 
        error: 'Failed to disconnect Instagram account',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // Get Instagram connection status for a brand
  fastify.get('/status/:brandId', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { brandId } = request.params as { brandId: string }
      const userId = user.userId

      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: userId
        }
      })

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found' })
      }

      const isConnected = !!(brand.instagramAccessToken && brand.instagramPageId)
      
      reply.send({ 
        connected: isConnected,
        profile: isConnected ? brand.instagramProfileData : null
      })
    } catch (error) {
      reply.status(500).send({ 
        error: 'Failed to check Instagram connection status',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })
}

export default instagram