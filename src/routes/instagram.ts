import { FastifyPluginAsync } from 'fastify'

import { verifyJWT } from '../services/jwt.js'
import { instagramService } from '../services/instagram.js'
import crypto from 'crypto'

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

// Helper function to validate webhook signatures
function validateWebhookSignature(payload: string, signature: string): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', process.env.FACEBOOK_APP_SECRET || 'test_secret')
    .update(payload)
    .digest('hex')

  const receivedSignature = signature.replace('sha256=', '')
  return crypto.timingSafeEqual(Buffer.from(expectedSignature, 'hex'), Buffer.from(receivedSignature, 'hex'))
}

const instagram: FastifyPluginAsync = async function (fastify) {
  // Get Instagram connection status and profile
  fastify.get('/status/:brandId', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { brandId } = request.params as { brandId: string }
      const { refresh } = request.query as { refresh?: string }

      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: user.id,
        },
      })

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found' })
      }

      const connected = instagramService.isConfigured(brand)
      let profile = null

      if (connected) {
        if (refresh === 'true') {
          // Fetch fresh profile data from Instagram API
          try {
            const freshProfile = await instagramService.getProfile(brand)

            // Update database with fresh profile data
            const updatedBrand = await prisma.brand.update({
              where: { id: brandId },
              data: {
                instagramProfileData: freshProfile as any,
              },
            })

            profile = freshProfile
          } catch (error) {
            console.error('Failed to refresh Instagram profile:', error)
            // Fallback to cached data if refresh fails
            profile = brand.instagramProfileData
          }
        } else {
          // Use cached profile data
          profile = brand.instagramProfileData
        }
      }

      reply.send({
        connected,
        profile,
      })
    } catch (error) {
      reply.status(500).send({
        error: 'Failed to fetch Instagram profile',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  // Get recent Instagram posts for a brand
  fastify.get('/posts/:brandId', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { brandId } = request.params as { brandId: string }
      const { limit = 25 } = request.query as { limit?: number }

      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: user.id,
        },
      })

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found' })
      }

      if (!instagramService.isConfigured(brand)) {
        return reply.status(400).send({ error: 'Instagram not connected for this brand' })
      }

      const posts = await instagramService.getRecentPosts(brand, limit)

      reply.send({ posts })
    } catch (error) {
      reply.status(500).send({
        error: 'Failed to fetch Instagram posts',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  // Refresh Instagram access token
  fastify.post('/refresh-token', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { brandId } = request.body as { brandId: string }

      if (!brandId) {
        return reply.status(400).send({ error: 'brandId is required' })
      }

      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: user.id,
        },
      })

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found' })
      }

      if (!brand.instagramAccessToken) {
        return reply.status(400).send({ error: 'No Instagram token to refresh' })
      }

      const refreshResult = await instagramService.refreshAccessToken(brand.instagramAccessToken)

      if (!refreshResult) {
        return reply.status(500).send({ error: 'Failed to refresh Instagram token' })
      }

      // Update brand with new token
      await prisma.brand.update({
        where: { id: brandId },
        data: {
          instagramAccessToken: refreshResult.accessToken,
          preferences: {
            ...((brand.preferences as any) || {}),
            tokenExpiresAt: refreshResult.expiresAt,
          },
        },
      })

      reply.send({
        success: true,
        expiresAt: refreshResult.expiresAt,
      })
    } catch (error) {
      reply.status(500).send({
        error: 'Failed to refresh Instagram token',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  // Publish content to Instagram
  fastify.post<{ Params: { contentId: string } }>('/publish/:contentId', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { contentId } = request.params

      if (!contentId) {
        return reply.status(400).send({ error: 'contentId is required' })
      }

      // Get content and verify ownership
      const content = await prisma.content.findFirst({
        where: {
          id: contentId,
          brand: {
            userId: user.id,
          },
        },
        include: {
          brand: true,
        },
      })

      if (!content) {
        return reply.status(404).send({ error: 'Content not found' })
      }

      if (content.status !== 'scheduled' && content.status !== 'draft') {
        return reply.status(400).send({ error: 'Content must be scheduled or in draft status before publishing' })
      }

      // Check if brand has Instagram connection
      if (!instagramService.isConfigured(content.brand)) {
        return reply.status(400).send({
          error: 'Instagram account not connected to this brand',
        })
      }

      // Enhanced content validation
      if (!content.imageUrl) {
        return reply.status(400).send({
          error: 'Image URL is required for Instagram posting',
          details: 'Content must have a valid image before publishing',
          retryable: false,
        })
      }

      if (!content.caption || content.caption.trim().length === 0) {
        return reply.status(400).send({
          error: 'Caption is required for Instagram posting',
          details: 'Content must have a non-empty caption',
          retryable: false,
        })
      }

      if (!content.hashtags || content.hashtags.length === 0) {
        return reply.status(400).send({
          error: 'At least one hashtag is required for Instagram posting',
          details: 'Content must include hashtags for better reach',
          retryable: false,
        })
      }

      // Publish to Instagram
      const publishResult = await instagramService.publishMedia(content.brand, {
        imageUrl: content.imageUrl,
        caption: content.caption,
        hashtags: content.hashtags,
      })

      // Update content status
      const updatedContent = await prisma.content.update({
        where: { id: contentId },
        data: {
          status: 'published',
          postedAt: new Date(),
          instagramPostId: publishResult.id,
          instagramPermalink: publishResult.permalink,
        },
      })

      reply.send({
        success: true,
        content: updatedContent,
        instagram: publishResult,
      })
    } catch (error) {
      console.error('Instagram publish error:', error)

      const errorMessage = error instanceof Error ? error.message : 'Failed to publish to Instagram'
      const isRetryable =
        !errorMessage.includes('permission') &&
        !errorMessage.includes('invalid token') &&
        !errorMessage.includes('not found')

      reply.status(500).send({
        error: errorMessage,
        retryable: isRetryable,
        timestamp: new Date().toISOString(),
        details: 'Check Instagram connection and try again',
      })
    }
  })

  // Get Instagram insights for a post
  fastify.get('/insights/:brandId/:postId', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { brandId, postId } = request.params as { brandId: string; postId: string }

      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: user.id,
        },
      })

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found' })
      }

      if (!instagramService.isConfigured(brand)) {
        return reply.status(400).send({
          error: 'Instagram account not connected',
        })
      }

      const insights = await instagramService.getMediaInsights(brand, postId)

      reply.send({ insights })
    } catch (error) {
      reply.status(500).send({
        error: 'Failed to fetch Instagram insights',
        message: error instanceof Error ? error.message : 'Unknown error',
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

      // Verify brand ownership and disconnect
      const updatedBrand = await prisma.brand.updateMany({
        where: {
          id: brandId,
          userId: user.id,
        },
        data: {
          instagramAccessToken: null,
          instagramPageId: null,
          instagramAccountId: null,
          instagramProfileData: { set: null },
        },
      })

      if (updatedBrand.count === 0) {
        return reply.status(404).send({ error: 'Brand not found' })
      }

      reply.send({ success: true })
    } catch (error) {
      reply.status(500).send({
        error: 'Failed to disconnect Instagram account',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  // Handle Instagram webhooks
  fastify.get<{ Querystring: { 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string } }>(
    '/webhooks',
    async function (request, reply) {
      const mode = request.query['hub.mode']
      const token = request.query['hub.verify_token']
      const challenge = request.query['hub.challenge']

      // Verify webhook
      if (mode === 'subscribe' && token === process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN) {
        reply.send(challenge)
      } else {
        reply.status(403).send('Forbidden')
      }
    }
  )

  fastify.post('/webhooks', async function (request, reply) {
    const signature = request.headers['x-hub-signature-256'] as string
    const payload = JSON.stringify(request.body)

    if (!signature || !validateWebhookSignature(payload, signature)) {
      return reply.status(403).send('Forbidden')
    }

    try {
      await instagramService.handleWebhookEvent(request.body)
      reply.send('OK')
    } catch (error) {
      reply.status(500).send('Error processing webhook')
    }
  })
}

export default instagram
