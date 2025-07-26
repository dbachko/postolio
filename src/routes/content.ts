import { FastifyPluginAsync } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { verifyJWT } from '../services/jwt.js'
import { generateInstagramContent, type ContentGenerationRequest } from '../services/content-generator.js'
import type { StyleProfile } from '../services/ai.js'

const prisma = new PrismaClient()

interface GenerateContentBody extends ContentGenerationRequest {}

interface ApproveContentBody {
  contentId: string
  scheduledAt?: string
}

const contentRoutes: FastifyPluginAsync = async (fastify) => {
  // Generate content for a brand
  fastify.post<{ Body: GenerateContentBody }>('/generate', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Authentication required' })
      }

      const token = authHeader.substring(7)
      const decoded = verifyJWT(token)
      const userId = decoded.id

      const { brandId, count, theme, style } = request.body

      // Verify user owns the brand
      const brand = await prisma.brand.findFirst({
        where: { 
          id: brandId,
          userId 
        },
        select: {
          id: true,
          name: true,
          styleProfile: true
        }
      })

      if (!brand) {
        return reply.code(404).send({ error: 'Brand not found' })
      }

      if (!brand.styleProfile) {
        return reply.code(400).send({ error: 'Brand must have a style profile to generate content' })
      }

      // Generate content using AI
      const generatedContent = await generateInstagramContent(
        brand.styleProfile as unknown as StyleProfile,
        brand.name,
        { brandId, count, theme: theme || undefined, style: style || undefined }
      )

      // Save generated content to database
      const contentRecords = await Promise.all(
        generatedContent.map(async (content) => {
          return prisma.content.create({
            data: {
              caption: content.caption,
              hashtags: content.hashtags,
              imageUrl: content.imageUrl || null,
              status: 'pending',
              brandId,
              generationParams: {
                theme,
                style,
                imagePrompt: content.imagePrompt,
                generatedAt: new Date().toISOString()
              } as any
            },
            select: {
              id: true,
              caption: true,
              hashtags: true,
              imageUrl: true,
              status: true,
              createdAt: true
            }
          })
        })
      )

      return reply.code(201).send({ 
        content: contentRecords,
        metadata: {
          brandId,
          count: contentRecords.length,
          theme,
          style
        }
      })
    } catch (error) {
      console.error('Content generation error:', error)
      return reply.code(500).send({ error: 'Failed to generate content' })
    }
  })

  // Get pending content for approval
  fastify.get<{ Params: { brandId: string } }>('/pending/:brandId', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Authentication required' })
      }

      const token = authHeader.substring(7)
      const decoded = verifyJWT(token)
      const userId = decoded.id

      const { brandId } = request.params

      // Verify user owns the brand
      const brand = await prisma.brand.findFirst({
        where: { 
          id: brandId,
          userId 
        }
      })

      if (!brand) {
        return reply.code(404).send({ error: 'Brand not found' })
      }

      const pendingContent = await prisma.content.findMany({
        where: {
          brandId,
          status: 'pending'
        },
        select: {
          id: true,
          caption: true,
          hashtags: true,
          imageUrl: true,
          status: true,
          createdAt: true,
          generationParams: true
        },
        orderBy: { createdAt: 'desc' }
      })

      return { content: pendingContent }
    } catch (error) {
      console.error('Pending content error:', error)
      return reply.code(500).send({ error: 'Failed to retrieve pending content' })
    }
  })

  // Approve content for posting
  fastify.post<{ Body: ApproveContentBody }>('/approve', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Authentication required' })
      }

      const token = authHeader.substring(7)
      const decoded = verifyJWT(token)
      const userId = decoded.id

      const { contentId, scheduledAt } = request.body

      // Verify user owns the content through brand ownership
      const content = await prisma.content.findFirst({
        where: { id: contentId },
        include: {
          brand: {
            select: { userId: true }
          }
        }
      })

      if (!content || content.brand.userId !== userId) {
        return reply.code(404).send({ error: 'Content not found' })
      }

      if (content.status !== 'pending') {
        return reply.code(400).send({ error: 'Content is not in pending status' })
      }

      // Update content status
      const updatedContent = await prisma.content.update({
        where: { id: contentId },
        data: {
          status: 'approved',
          scheduledAt: scheduledAt ? new Date(scheduledAt) : null
        },
        select: {
          id: true,
          caption: true,
          hashtags: true,
          imageUrl: true,
          status: true,
          scheduledAt: true,
          updatedAt: true
        }
      })

      return { content: updatedContent }
    } catch (error) {
      console.error('Content approval error:', error)
      return reply.code(500).send({ error: 'Failed to approve content' })
    }
  })

  // Reject content
  fastify.post<{ Params: { contentId: string } }>('/reject/:contentId', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Authentication required' })
      }

      const token = authHeader.substring(7)
      const decoded = verifyJWT(token)
      const userId = decoded.id

      const { contentId } = request.params

      // Verify user owns the content through brand ownership
      const content = await prisma.content.findFirst({
        where: { id: contentId },
        include: {
          brand: {
            select: { userId: true }
          }
        }
      })

      if (!content || content.brand.userId !== userId) {
        return reply.code(404).send({ error: 'Content not found' })
      }

      // Update content status
      const updatedContent = await prisma.content.update({
        where: { id: contentId },
        data: {
          status: 'rejected'
        },
        select: {
          id: true,
          status: true,
          updatedAt: true
        }
      })

      return { content: updatedContent }
    } catch (error) {
      console.error('Content rejection error:', error)
      return reply.code(500).send({ error: 'Failed to reject content' })
    }
  })

  // Get content history
  fastify.get<{ Params: { brandId: string } }>('/history/:brandId', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Authentication required' })
      }

      const token = authHeader.substring(7)
      const decoded = verifyJWT(token)
      const userId = decoded.id

      const { brandId } = request.params

      // Verify user owns the brand
      const brand = await prisma.brand.findFirst({
        where: { 
          id: brandId,
          userId 
        }
      })

      if (!brand) {
        return reply.code(404).send({ error: 'Brand not found' })
      }

      const contentHistory = await prisma.content.findMany({
        where: {
          brandId,
          status: { in: ['approved', 'posted', 'rejected'] }
        },
        select: {
          id: true,
          caption: true,
          hashtags: true,
          imageUrl: true,
          status: true,
          scheduledAt: true,
          postedAt: true,
          createdAt: true,
          updatedAt: true
        },
        orderBy: { updatedAt: 'desc' },
        take: 50 // Limit to last 50 items
      })

      return { content: contentHistory }
    } catch (error) {
      console.error('Content history error:', error)
      return reply.code(500).send({ error: 'Failed to retrieve content history' })
    }
  })
}

export default contentRoutes