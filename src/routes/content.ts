import { FastifyPluginAsync } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { verifyJWT } from '../services/jwt.js'
import { generateInstagramContent, type ContentGenerationRequest } from '../services/content-generator.js'
import type { StyleProfile } from '../services/ai.js'
import learningService from '../services/learning.js'

const prisma = new PrismaClient()

interface GenerateContentBody extends ContentGenerationRequest {}

interface ApproveContentBody {
  contentId: string
  scheduledAt?: string
}

interface UpdateContentBody {
  contentId: string
  caption?: string
  hashtags?: string[]
  imageUrl?: string
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
          // Validate content before saving
          if (!content.caption || content.caption.trim().length === 0) {
            console.error('Generated content has empty caption:', content)
            throw new Error('Generated content has empty caption')
          }
          if (!content.hashtags || !Array.isArray(content.hashtags)) {
            console.error('Generated content has invalid hashtags:', content)
            throw new Error('Generated content has invalid hashtags')
          }

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
      
      // Handle specific OpenAI errors with appropriate status codes
      if (error instanceof Error) {
        if (error.message.includes('OpenAI API key configuration error')) {
          return reply.code(503).send({ error: 'AI service configuration error. Please contact support.' })
        }
        if (error.message.includes('OpenAI API quota exceeded')) {
          return reply.code(503).send({ error: 'AI service quota exceeded. Please try again later.' })
        }
        if (error.message.includes('OpenAI API rate limit exceeded')) {
          return reply.code(429).send({ error: 'AI service rate limit exceeded. Please try again in a moment.' })
        }
      }
      
      return reply.code(500).send({ error: 'Failed to generate content. Please try again.' })
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

  // Update content
  fastify.put<{ Body: UpdateContentBody }>('/update', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Authentication required' })
      }

      const token = authHeader.substring(7)
      const decoded = verifyJWT(token)
      const userId = decoded.id

      const { contentId, caption, hashtags, imageUrl, scheduledAt } = request.body

      // Verify user owns the content through brand ownership
      const content = await prisma.content.findFirst({
        where: { id: contentId },
        include: {
          brand: {
            select: { userId: true, id: true }
          }
        }
      })

      if (!content || content.brand.userId !== userId) {
        return reply.code(404).send({ error: 'Content not found' })
      }

      // Store original content for learning analysis
      const originalContent = {
        caption: content.caption,
        hashtags: content.hashtags,
        imageUrl: content.imageUrl || undefined,
        scheduledAt: content.scheduledAt?.toISOString()
      }

      // Build update data - only include fields that are provided
      const updateData: any = {}
      if (caption !== undefined) {
        // Strict validation: caption must be a non-empty string
        if (!caption || typeof caption !== 'string' || caption.trim().length === 0) {
          console.error('CRITICAL: Attempt to update content with invalid caption', {
            contentId,
            caption,
            captionType: typeof caption,
            captionLength: caption?.length || 0
          })
          return reply.code(400).send({ error: 'Caption cannot be empty or invalid' })
        }
        updateData.caption = caption.trim() // Ensure we store trimmed caption
      }
      if (hashtags !== undefined) updateData.hashtags = hashtags
      if (imageUrl !== undefined) updateData.imageUrl = imageUrl
      if (scheduledAt !== undefined) {
        updateData.scheduledAt = scheduledAt ? new Date(scheduledAt) : null
      }

      // Update content
      const updatedContent = await prisma.content.update({
        where: { id: contentId },
        data: updateData,
        select: {
          id: true,
          caption: true,
          hashtags: true,
          imageUrl: true,
          status: true,
          scheduledAt: true,
          postedAt: true,
          createdAt: true,
          updatedAt: true,
          brandId: true
        }
      })

      // Apply AI learning if there were changes
      let learningResults = null
      const hasChanges = 
        (caption !== undefined && caption !== originalContent.caption) ||
        (hashtags !== undefined && JSON.stringify(hashtags) !== JSON.stringify(originalContent.hashtags)) ||
        (imageUrl !== undefined && imageUrl !== originalContent.imageUrl) ||
        (scheduledAt !== undefined && scheduledAt !== originalContent.scheduledAt)

      if (hasChanges) {
        try {
          const editedContent = {
            caption: updatedContent.caption,
            hashtags: updatedContent.hashtags,
            imageUrl: updatedContent.imageUrl || undefined,
            scheduledAt: updatedContent.scheduledAt?.toISOString()
          }

          // Analyze the edit and apply learning (async, don't block response)
          learningService.analyzeUserEdit(content.brand.id, originalContent, editedContent)
            .then(editAnalysis => learningService.applyLearningToStyleProfile(content.brand.id, editAnalysis))
            .then(results => {
              console.log(`Learning applied for brand ${content.brand.id}:`, {
                insights: results.insights.length,
                profileUpdates: results.profileUpdates.length,
                appliedToFuturePosts: results.appliedToFuturePosts
              })
            })
            .catch(error => {
              console.error('Learning application error:', error)
            })

          // Provide immediate feedback about learning
          learningResults = {
            learningActive: true,
            message: 'AI is learning from your edits...'
          }
        } catch (error) {
          console.error('Learning analysis error:', error)
        }
      }

      return { 
        content: updatedContent,
        learning: learningResults
      }
    } catch (error) {
      console.error('Content update error:', error)
      return reply.code(500).send({ error: 'Failed to update content' })
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
          status: { in: ['approved', 'posted', 'rejected', 'scheduled'] }
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