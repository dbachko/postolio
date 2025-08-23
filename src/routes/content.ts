import { FastifyPluginAsync } from 'fastify'
import { Prisma } from '@prisma/client'

import { verifyJWT } from '../services/jwt.js'
import { generateInstagramContent, type ContentGenerationRequest } from '../services/content-generator.js'
import type { StyleProfile } from '../services/ai.js'
import learningService from '../services/learning.js'
import { uploadImageBufferToS3, type ImageMetadata } from '../services/s3-image.js'
import { computePlaceholders } from '../services/placeholderService.js'
import { schedulerService } from '../services/scheduler.js'
import { PublisherContentService } from '../services/publisher-content.js'

import { getDatabaseClient } from '../config/database.js'

const prisma = getDatabaseClient()

interface GenerateContentBody extends ContentGenerationRequest {}

interface ApproveContentBody {
  contentId: string
  scheduledAt?: string
}

interface CreateManualContentBody {
  brandId: string
  caption: string
  hashtags: string[]
  imageData?: string
  mimeType?: string
}

interface UpdateContentBody {
  contentId: string
  caption?: string
  hashtags?: string[]
  cdnImageUrl?: string
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
          userId,
        },
        select: {
          id: true,
          name: true,
          styleProfile: true,
        },
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
              s3ImageKey: content.s3ImageKey || null,
              cdnImageUrl: content.cdnImageUrl || null,
              imageRegion: content.imageRegion || null,
              retentionExpiresAt: content.retentionExpiresAt || null,
              status: 'draft',
              brandId,
              generationParams: {
                theme,
                style,
                imagePrompt: content.imagePrompt,
                generatedAt: new Date().toISOString(),
              } as any,
            },
            select: {
              id: true,
              caption: true,
              hashtags: true,
              s3ImageKey: true,
              cdnImageUrl: true,
              imageRegion: true,
              retentionExpiresAt: true,
              status: true,
              createdAt: true,
            },
          })
        })
      )

      return reply.code(201).send({
        content: contentRecords,
        metadata: {
          brandId,
          count: contentRecords.length,
          theme,
          style,
        },
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

  // Create manual content (user-generated, not AI)
  fastify.post<{ Body: CreateManualContentBody }>('/create', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Authentication required' })
      }

      const token = authHeader.substring(7)
      const decoded = verifyJWT(token)
      const userId = decoded.id

      const { brandId, caption, hashtags, imageData } = request.body

      // Validate input
      if (!caption || caption.trim().length === 0) {
        return reply.code(400).send({ error: 'Caption is required' })
      }

      if (caption.length > 2200) {
        return reply.code(400).send({ error: 'Caption exceeds Instagram limit of 2200 characters' })
      }

      if (!Array.isArray(hashtags)) {
        return reply.code(400).send({ error: 'Hashtags must be an array' })
      }

      if (hashtags.length > 30) {
        return reply.code(400).send({ error: 'Maximum 30 hashtags allowed' })
      }

      // Verify user owns the brand
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId,
        },
        select: {
          id: true,
          name: true,
        },
      })

      if (!brand) {
        return reply.code(404).send({ error: 'Brand not found' })
      }

      let s3ImageKey: string | null = null
      let cdnImageUrl: string | null = null
      let imageRegion: string | null = null
      let retentionExpiresAt: Date | null = null

      // Handle image upload if provided
      if (imageData) {
        try {
          // Extract base64 data
          const base64Match = imageData.match(/^data:([^;]+);base64,(.+)$/)
          if (!base64Match || !base64Match[2]) {
            return reply.code(400).send({ error: 'Invalid image data format' })
          }

          const buffer = Buffer.from(base64Match[2], 'base64')

          // Upload to S3
          const uploadResult = await uploadImageBufferToS3(buffer, {
            contentId: `manual-${Date.now()}-${Math.random().toString(36).substring(7)}`,
            brandId,
            generatedAt: new Date(),
            source: 'dalle3' as const, // Use dalle3 as placeholder for manual uploads
            originalPrompt: '',
          })

          s3ImageKey = uploadResult.s3Key
          cdnImageUrl = uploadResult.cdnUrl
          imageRegion = uploadResult.region
          retentionExpiresAt = uploadResult.retentionExpiresAt
        } catch (uploadError) {
          console.error('Image upload error:', uploadError)
          // Continue without image rather than failing entirely
        }
      }

      // Create content record
      const content = await prisma.content.create({
        data: {
          caption,
          hashtags,
          s3ImageKey,
          cdnImageUrl,
          imageRegion,
          retentionExpiresAt,
          status: 'draft',
          brandId,
          generationParams: Prisma.JsonNull, // null indicates manual creation
        },
        select: {
          id: true,
          caption: true,
          hashtags: true,
          s3ImageKey: true,
          cdnImageUrl: true,
          imageRegion: true,
          retentionExpiresAt: true,
          status: true,
          brandId: true,
          generationParams: true,
          createdAt: true,
        },
      })

      return reply.code(201).send({
        content,
        metadata: {
          brandId,
          source: 'manual',
        },
      })
    } catch (error) {
      console.error('Manual content creation error:', error)
      return reply.code(500).send({ error: 'Failed to create content' })
    }
  })

  // Get draft content for review
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
          userId,
        },
      })

      if (!brand) {
        return reply.code(404).send({ error: 'Brand not found' })
      }

      const draftContent = await prisma.content.findMany({
        where: {
          brandId,
          status: 'draft',
        },
        select: {
          id: true,
          caption: true,
          hashtags: true,
          s3ImageKey: true,
          cdnImageUrl: true,
          imageRegion: true,
          status: true,
          createdAt: true,
          generationParams: true,
        },
        orderBy: { createdAt: 'desc' },
      })

      return { content: draftContent }
    } catch (error) {
      console.error('Draft content error:', error)
      return reply.code(500).send({ error: 'Failed to retrieve draft content' })
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
            select: { userId: true },
          },
        },
      })

      if (!content || content.brand.userId !== userId) {
        return reply.code(404).send({ error: 'Content not found' })
      }

      if (content.status !== 'draft') {
        return reply.code(400).send({ error: 'Content is not in draft status' })
      }

      // Update content status - use 'scheduled' if scheduledAt provided
      const updatedContent = await prisma.content.update({
        where: { id: contentId },
        data: {
          status: scheduledAt ? 'scheduled' : 'draft',
          scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        },
        select: {
          id: true,
          caption: true,
          hashtags: true,
          status: true,
          scheduledAt: true,
          updatedAt: true,
        },
      })

      // If scheduledAt is provided, create a schedule in AWS
      if (scheduledAt) {
        try {
          // Don't pass customTime - let scheduler-adapter read scheduledAt from database
          // This avoids timezone conversion issues since DB stores UTC
          const scheduleResult = await schedulerService.scheduleContent(contentId)
          
          if (!scheduleResult.success) {
            console.error('Failed to create AWS schedule:', scheduleResult.error)
            // Note: We don't fail the request here as the content is already scheduled locally
            // The scheduler adapter has fallback logic
          } else {
            console.log(`Content ${contentId} scheduled successfully in AWS`)
          }
        } catch (scheduleError) {
          console.error('Error calling scheduler service:', scheduleError)
          // Continue with local scheduling
        }
      }

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
            select: { userId: true },
          },
        },
      })

      if (!content || content.brand.userId !== userId) {
        return reply.code(404).send({ error: 'Content not found' })
      }

      // Update content status - reject means back to draft
      const updatedContent = await prisma.content.update({
        where: { id: contentId },
        data: {
          status: 'draft',
          scheduledAt: null, // Clear any scheduled time
        },
        select: {
          id: true,
          status: true,
          updatedAt: true,
        },
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

      const { contentId, caption, hashtags, cdnImageUrl, scheduledAt } = request.body

      // Verify user owns the content through brand ownership
      const content = await prisma.content.findFirst({
        where: { id: contentId },
        include: {
          brand: {
            select: { userId: true, id: true },
          },
        },
      })

      if (!content || content.brand.userId !== userId) {
        return reply.code(404).send({ error: 'Content not found' })
      }

      // Store original content for learning analysis
      const originalContent: {
        caption: string
        hashtags: string[]
        cdnImageUrl?: string | null
        scheduledAt?: string
      } = {
        caption: content.caption,
        hashtags: content.hashtags,
        ...(content.cdnImageUrl ? { cdnImageUrl: content.cdnImageUrl } : {}),
        ...(content.scheduledAt ? { scheduledAt: content.scheduledAt.toISOString() } : {}),
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
            captionLength: caption?.length || 0,
          })
          return reply.code(400).send({ error: 'Caption cannot be empty or invalid' })
        }
        updateData.caption = caption.trim() // Ensure we store trimmed caption
      }
      if (hashtags !== undefined) updateData.hashtags = hashtags
      if (cdnImageUrl !== undefined) {
        updateData.cdnImageUrl = cdnImageUrl
        // If cdnImageUrl is empty, also clear S3-related fields
        if (cdnImageUrl === '' || cdnImageUrl === null) {
          updateData.s3ImageKey = null
          updateData.cdnImageUrl = null
          updateData.imageRegion = null
          updateData.retentionExpiresAt = null
        }
      }
      if (scheduledAt !== undefined) {
        updateData.scheduledAt = scheduledAt ? new Date(scheduledAt) : null
        // When setting a scheduledAt date, ensure proper status
        // Don't change status if content is already published
        if (scheduledAt && content.status !== 'published') {
          // Set to scheduled when adding a scheduled time
          if (content.status === 'draft') {
            updateData.status = 'scheduled'
          } else if (content.status === 'failed' || content.status === 'skipped') {
            // Don't allow scheduling of failed/skipped content
            return reply.code(400).send({ error: 'Cannot schedule failed or skipped content' })
          }
        } else if (!scheduledAt && content.status === 'scheduled') {
          // If removing scheduledAt, revert to draft
          updateData.status = 'draft'
        }
      }

      // Log the update for debugging
      console.log('Updating content with data:', {
        contentId,
        updateData,
        originalScheduledAt: content.scheduledAt,
        originalStatus: content.status
      })

      // Update content
      const updatedContent = await prisma.content.update({
        where: { id: contentId },
        data: updateData,
        select: {
          id: true,
          caption: true,
          hashtags: true,
          cdnImageUrl: true,
          status: true,
          scheduledAt: true,
          postedAt: true,
          createdAt: true,
          updatedAt: true,
          brandId: true,
        },
      })

      // Invalidate publisher content cache after update
      // This ensures fresh content is fetched at publish time
      await PublisherContentService.invalidateContentCache(contentId)

      // Log the result for debugging
      console.log('Content update result:', {
        contentId: updatedContent.id,
        newScheduledAt: updatedContent.scheduledAt,
        newStatus: updatedContent.status,
        updateSuccessful: true
      })

      // Handle scheduling changes with AWS ContentScheduler
      if (scheduledAt !== undefined) {
        const originalScheduledTime = content.scheduledAt?.toISOString()
        const newScheduledTime = updatedContent.scheduledAt?.toISOString()
        
        // Case 1: New schedule (wasn't scheduled before, now is)
        if (!originalScheduledTime && newScheduledTime) {
          try {
            // Don't pass customTime - scheduler-adapter will read from DB (UTC)
            const scheduleResult = await schedulerService.scheduleContent(contentId)
            
            if (!scheduleResult.success) {
              console.error('Failed to create AWS schedule:', scheduleResult.error)
            } else {
              console.log(`Content ${contentId} scheduled successfully in AWS`)
            }
          } catch (scheduleError) {
            console.error('Error creating schedule:', scheduleError)
          }
        }
        // Case 2: Cancel schedule (was scheduled, now isn't)
        else if (originalScheduledTime && !newScheduledTime) {
          try {
            const cancelResult = await schedulerService.cancelScheduledPost(contentId)
            
            if (cancelResult) {
              console.log(`Schedule for content ${contentId} cancelled successfully`)
            } else {
              console.error('Failed to cancel AWS schedule for content:', contentId)
            }
          } catch (cancelError) {
            console.error('Error cancelling schedule:', cancelError)
          }
        }
        // Case 3: Reschedule (time changed)
        else if (originalScheduledTime && newScheduledTime && originalScheduledTime !== newScheduledTime) {
          try {
            // For rescheduling, also don't pass customTime
            // The scheduler-adapter will read the updated scheduledAt from DB
            const rescheduleResult = await schedulerService.reschedulePost(contentId, updatedContent.scheduledAt!)
            
            if (!rescheduleResult.success) {
              console.error('Failed to reschedule in AWS:', rescheduleResult.error)
            } else {
              console.log(`Content ${contentId} rescheduled successfully in AWS`)
            }
          } catch (rescheduleError) {
            console.error('Error rescheduling:', rescheduleError)
          }
        }
      }

      // Apply AI learning if there were changes
      let learningResults = null
      const hasChanges =
        (caption !== undefined && caption !== originalContent.caption) ||
        (hashtags !== undefined && JSON.stringify(hashtags) !== JSON.stringify(originalContent.hashtags)) ||
        (cdnImageUrl !== undefined && cdnImageUrl !== originalContent.cdnImageUrl) ||
        (scheduledAt !== undefined && scheduledAt !== originalContent.scheduledAt)

      if (hasChanges) {
        try {
          const editedContent: {
            caption: string
            hashtags: string[]
            cdnImageUrl?: string | null
            scheduledAt?: string
          } = {
            caption: updatedContent.caption,
            hashtags: updatedContent.hashtags,
            ...(updatedContent.cdnImageUrl ? { cdnImageUrl: updatedContent.cdnImageUrl } : {}),
            ...(updatedContent.scheduledAt ? { scheduledAt: updatedContent.scheduledAt.toISOString() } : {}),
          }

          // Analyze the edit and apply learning (async, don't block response)
          learningService
            .analyzeUserEdit(content.brand.id, originalContent, editedContent)
            .then((editAnalysis) => learningService.applyLearningToStyleProfile(content.brand.id, editAnalysis))
            .then((results) => {
              console.log(`Learning applied for brand ${content.brand.id}:`, {
                insights: results.insights.length,
                profileUpdates: results.profileUpdates.length,
                appliedToFuturePosts: results.appliedToFuturePosts,
              })
            })
            .catch((error) => {
              console.error('Learning application error:', error)
            })

          // Provide immediate feedback about learning
          learningResults = {
            learningActive: true,
            message: 'AI is learning from your edits...',
          }
        } catch (error) {
          console.error('Learning analysis error:', error)
        }
      }

      return {
        content: updatedContent,
        learning: learningResults,
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
          userId,
        },
      })

      if (!brand) {
        return reply.code(404).send({ error: 'Brand not found' })
      }

      const contentHistory = await prisma.content.findMany({
        where: {
          brandId,
          status: { in: ['draft', 'scheduled', 'published', 'failed', 'skipped'] },
        },
        select: {
          id: true,
          caption: true,
          hashtags: true,
          s3ImageKey: true,
          cdnImageUrl: true,
          imageRegion: true,
          retentionExpiresAt: true,
          status: true,
          scheduledAt: true,
          postedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: 50, // Limit to last 50 items
      })

      return { content: contentHistory }
    } catch (error) {
      console.error('Content history error:', error)
      return reply.code(500).send({ error: 'Failed to retrieve content history' })
    }
  })

  // Upload image for content
  fastify.post<{ 
    Body: { 
      contentId: string
      imageData: string  // Base64 encoded image data
      mimeType: string
    } 
  }>('/upload-image', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Authentication required' })
      }

      const token = authHeader.substring(7)
      const decoded = verifyJWT(token)
      const userId = decoded.id

      const { contentId, imageData, mimeType } = request.body

      // Validate input
      if (!contentId || !imageData || !mimeType) {
        return reply.code(400).send({ error: 'Missing required fields' })
      }

      // Validate mime type
      const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp']
      if (!allowedMimeTypes.includes(mimeType)) {
        return reply.code(400).send({ error: 'Invalid image type. Supported types: JPEG, PNG, WebP' })
      }

      // Verify user owns the content through brand ownership
      const content = await prisma.content.findFirst({
        where: { id: contentId },
        include: {
          brand: {
            select: { userId: true, id: true },
          },
        },
      })

      if (!content || content.brand.userId !== userId) {
        return reply.code(404).send({ error: 'Content not found' })
      }

      try {
        // Convert base64 to buffer - validate size BEFORE creating buffer
        const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '')
        
        // Calculate estimated size from base64 length
        // Base64 encoding represents every 3 bytes of binary data as 4 ASCII characters (4/3 ratio).
        // To estimate the original binary size, multiply the base64 string length by 3/4.
        const estimatedSize = (base64Data.length * 3) / 4
        const maxSize = 10 * 1024 * 1024
        
        if (estimatedSize > maxSize) {
          return reply.code(400).send({ 
            error: `Image size exceeds 10MB limit. Estimated size: ${(estimatedSize / (1024 * 1024)).toFixed(2)}MB` 
          })
        }
        
        // Now safe to create buffer
        const buffer = Buffer.from(base64Data, 'base64')
        
        // Double-check actual size
        if (buffer.length > maxSize) {
          return reply.code(400).send({ error: 'Image size exceeds 10MB limit' })
        }

        // Upload to S3
        let uploadResult = null
        let imageUrlToStore = ''
        
        try {
          const metadata: ImageMetadata = {
            contentId: content.id,
            brandId: content.brand.id,
            campaignId: content.campaignId || undefined,
            generatedAt: new Date(),
            source: 'dalle3', // Mark as user upload (we use dalle3 as default)
            originalPrompt: 'User uploaded image',
          }

          console.log('Uploading user image to S3 for content:', contentId)
          console.log('Image buffer size:', buffer.length, 'bytes')
          console.log('MIME type:', mimeType)
          
          uploadResult = await uploadImageBufferToS3(buffer, metadata)
          imageUrlToStore = uploadResult.cdnUrl
          
          console.log('Upload successful! CDN URL:', imageUrlToStore)
        } catch (s3Error) {
          console.error('S3 upload failed:', s3Error)
          // Fail gracefully instead of storing large base64 data URLs
          return reply.code(500).send({ error: 'Failed to upload image to storage. Please try again.' })
        }
        
        // Update content with S3 URLs or fallback
        const updateData: any = {
          cdnImageUrl: imageUrlToStore,
        }
        
        // Only add S3 fields if upload succeeded
        if (uploadResult) {
          updateData.s3ImageKey = uploadResult.s3Key
          updateData.cdnImageUrl = uploadResult.cdnUrl
          updateData.imageRegion = uploadResult.region
          updateData.retentionExpiresAt = uploadResult.retentionExpiresAt
        }
        
        const updatedContent = await prisma.content.update({
          where: { id: contentId },
          data: updateData,
          select: {
            id: true,
            caption: true,
            hashtags: true,
              s3ImageKey: true,
            cdnImageUrl: true,
            status: true,
            scheduledAt: true,
            createdAt: true,
            updatedAt: true,
          },
        })

        return reply.send({
          success: true,
          content: updatedContent,
          message: 'Image uploaded successfully',
        })

      } catch (uploadError) {
        console.error('Image upload error:', uploadError)
        return reply.code(500).send({ error: 'Failed to upload image' })
      }

    } catch (error) {
      console.error('Upload image error:', error)
      return reply.code(500).send({ error: 'Failed to process image upload' })
    }
  })

  // Get calendar content with placeholders
  fastify.get<{
    Params: { brandId: string; month: string }
  }>('/calendar/:brandId/:month', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Authentication required' })
      }

      const token = authHeader.substring(7)
      const decoded = verifyJWT(token)
      const userId = decoded.id

      const { brandId, month } = request.params

      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: { id: brandId, userId }
      })

      if (!brand) {
        return reply.code(404).send({ 
          success: false, 
          error: 'Brand not found' 
        })
      }

      // Parse month string (format: YYYY-MM)
      const parts = month.split('-')
      if (parts.length !== 2) {
        return reply.code(400).send({ error: 'Invalid month format. Use YYYY-MM' })
      }
      
      const [yearStr, monthStr] = parts
      if (!yearStr || !monthStr) {
        return reply.code(400).send({ error: 'Invalid month format. Use YYYY-MM' })
      }
      
      const year = parseInt(yearStr, 10)
      const monthNum = parseInt(monthStr, 10)
      
      if (isNaN(year) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
        return reply.code(400).send({ error: 'Invalid month format. Use YYYY-MM' })
      }
      
      const monthStart = new Date(year, monthNum - 1, 1)
      const monthEnd = new Date(year, monthNum, 0, 23, 59, 59)

      // Get existing content for the month
      const content = await prisma.content.findMany({
        where: {
          brandId,
          OR: [
            {
              scheduledAt: {
                gte: monthStart,
                lte: monthEnd
              }
            },
            {
              postedAt: {
                gte: monthStart,
                lte: monthEnd
              }
            }
          ]
        },
        orderBy: { scheduledAt: 'asc' }
      })

      // Get active campaigns
      const campaigns = await prisma.campaign.findMany({
        where: {
          brandId,
          status: { in: ['active', 'preview'] }
        }
      })

      // Compute placeholders
      const placeholders = computePlaceholders(campaigns, content, monthStart, monthEnd)

      return {
        success: true,
        data: {
          content,
          placeholders
        }
      }
    } catch (error) {
      console.error('Calendar content error:', error)
      return reply.code(500).send({ error: 'Failed to retrieve calendar content' })
    }
  })
}

export default contentRoutes
