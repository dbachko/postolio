import { PrismaClient } from '@prisma/client'
import { analyticsService } from './analytics.js'
import { instagramService, mockInstagramService } from './instagram.js'

const prisma = new PrismaClient()

export interface ScheduledPost {
  id: string
  contentId: string
  brandId: string
  scheduledTime: Date
  status: 'pending' | 'processing' | 'posted' | 'failed'
  retryCount: number
  lastError?: string
}

export interface SchedulingResult {
  success: boolean
  scheduledPost?: ScheduledPost
  error?: string
}

class SchedulerService {
  private isRunning = false
  private intervalId: NodeJS.Timeout | null = null

  /**
   * Schedule content for optimal posting time
   */
  async scheduleContent(contentId: string, customTime?: Date): Promise<SchedulingResult> {
    try {
      const content = await prisma.content.findFirst({
        where: {
          id: contentId,
          status: 'approved'
        },
        include: {
          brand: true
        }
      })

      if (!content) {
        return { success: false, error: 'Content not found or not approved' }
      }

      let scheduledTime: Date

      if (customTime) {
        // Use provided custom time
        scheduledTime = customTime
      } else {
        // Get optimal time recommendation
        const recommendation = await analyticsService.getSchedulingRecommendation(content.brandId)
        scheduledTime = recommendation.recommendedTime
      }

      // Create scheduled post entry
      const scheduledPost = await this.createScheduledPost(contentId, content.brandId, scheduledTime)

      // Update content status
      await prisma.content.update({
        where: { id: contentId },
        data: {
          status: 'scheduled' as any, // Add this status to the enum
          scheduledAt: scheduledTime
        }
      })

      return {
        success: true,
        scheduledPost
      }
    } catch (error) {
      console.error('Failed to schedule content:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Create a scheduled post entry
   */
  private async createScheduledPost(contentId: string, brandId: string, scheduledTime: Date): Promise<ScheduledPost> {
    // Since we don't have a ScheduledPost model in Prisma, we'll store it as metadata in the content
    // In a production app, you'd want a separate scheduled_posts table
    return {
      id: `schedule_${contentId}_${Date.now()}`,
      contentId,
      brandId,
      scheduledTime,
      status: 'pending',
      retryCount: 0
    }
  }

  /**
   * Start the scheduler service
   */
  start(): void {
    if (this.isRunning) {
      console.log('Scheduler is already running')
      return
    }

    this.isRunning = true
    console.log('Starting scheduler service...')

    // Check for scheduled posts every minute
    this.intervalId = setInterval(() => {
      this.processScheduledPosts()
    }, 60 * 1000)

    // Also run immediately
    this.processScheduledPosts()
  }

  /**
   * Stop the scheduler service
   */
  stop(): void {
    if (!this.isRunning) {
      return
    }

    this.isRunning = false
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    console.log('Scheduler service stopped')
  }

  /**
   * Process all scheduled posts that are ready to be published
   */
  private async processScheduledPosts(): Promise<void> {
    try {
      const now = new Date()
      
      // Find content scheduled for posting within the next 5 minutes
      const readyContent = await prisma.content.findMany({
        where: {
          status: 'approved',
          scheduledAt: {
            lte: new Date(now.getTime() + 5 * 60 * 1000) // Next 5 minutes
          }
        },
        include: {
          brand: true
        },
        take: 10 // Process in batches
      })

      for (const content of readyContent) {
        await this.publishScheduledContent(content)
      }

      // Also process any failed posts for retry
      await this.retryFailedPosts()

    } catch (error) {
      console.error('Error processing scheduled posts:', error)
    }
  }

  /**
   * Publish a scheduled content item
   */
  private async publishScheduledContent(content: any): Promise<void> {
    try {
      console.log(`Publishing scheduled content: ${content.id}`)

      // Check if brand has Instagram connection
      if (!content.brand.instagramAccessToken || !content.brand.instagramPageId) {
        await this.markContentAsFailed(content.id, 'Instagram account not connected')
        return
      }

      // Initialize Instagram service
      const service = instagramService.isConfigured() ? instagramService : mockInstagramService
      if (instagramService.isConfigured()) {
        instagramService.initializeClient(
          content.brand.instagramAccessToken,
          content.brand.instagramPageId
        )
      }

      // Validate image URL if present
      if (content.imageUrl) {
        const isValidImage = await service.validateImageUrl(content.imageUrl)
        if (!isValidImage) {
          await this.markContentAsFailed(content.id, 'Invalid or inaccessible image URL')
          return
        }
      }

      // Publish to Instagram
      const publishResult = await service.publishPost({
        imageUrl: content.imageUrl || 'https://via.placeholder.com/400?text=Scheduled+Post',
        caption: content.caption,
        hashtags: content.hashtags
      })

      // Update content status
      await prisma.content.update({
        where: { id: content.id },
        data: {
          status: 'posted',
          postedAt: new Date(),
          instagramPostId: publishResult.id,
          instagramPermalink: publishResult.permalink
        }
      })

      console.log(`Successfully published content: ${content.id}`)

      // Schedule metrics collection for later
      setTimeout(async () => {
        await analyticsService.collectPostMetrics(content.id)
      }, 60 * 60 * 1000) // Collect metrics after 1 hour

    } catch (error) {
      console.error(`Failed to publish scheduled content ${content.id}:`, error)
      await this.markContentAsFailed(content.id, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  /**
   * Mark content as failed with error message
   */
  private async markContentAsFailed(contentId: string, errorMessage: string): Promise<void> {
    try {
      await prisma.content.update({
        where: { id: contentId },
        data: {
          status: 'failed' as any, // Add this status to the enum
          schedulingError: errorMessage,
          scheduledAt: null
        }
      })
    } catch (error) {
      console.error('Failed to mark content as failed:', error)
    }
  }

  /**
   * Retry failed posts that are eligible for retry
   */
  private async retryFailedPosts(): Promise<void> {
    try {
      // Find failed posts that were scheduled within the last 24 hours and haven't been retried too many times
      const failedContent = await prisma.content.findMany({
        where: {
          status: 'failed' as any,
          scheduledAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
          }
        },
        include: {
          brand: true
        },
        take: 5 // Limit retries
      })

      for (const content of failedContent) {
        // Get metadata to check retry count
        const metadata = content.generationParams as any
        const retryCount = metadata?.retryCount || 0

        if (retryCount < 3) { // Max 3 retries
          console.log(`Retrying failed content: ${content.id} (attempt ${retryCount + 1})`)
          
          // Update retry count
          await prisma.content.update({
            where: { id: content.id },
            data: {
              status: 'approved',
              generationParams: {
                ...metadata,
                retryCount: retryCount + 1
              }
            }
          })

          // Try to publish again
          await this.publishScheduledContent(content)
        }
      }
    } catch (error) {
      console.error('Error retrying failed posts:', error)
    }
  }

  /**
   * Get scheduled posts for a brand
   */
  async getScheduledPosts(brandId: string): Promise<any[]> {
    try {
      const scheduledContent = await prisma.content.findMany({
        where: {
          brandId: brandId,
          status: 'approved',
          scheduledAt: { not: null }
        },
        orderBy: {
          scheduledAt: 'asc'
        }
      })

      return scheduledContent.map(content => ({
        id: content.id,
        caption: content.caption,
        imageUrl: content.imageUrl,
        hashtags: content.hashtags,
        scheduledTime: content.scheduledAt,
        status: 'pending'
      }))
    } catch (error) {
      console.error('Failed to get scheduled posts:', error)
      return []
    }
  }

  /**
   * Cancel a scheduled post
   */
  async cancelScheduledPost(contentId: string): Promise<boolean> {
    try {
      await prisma.content.update({
        where: { id: contentId },
        data: {
          status: 'approved',
          scheduledAt: null
        }
      })
      return true
    } catch (error) {
      console.error('Failed to cancel scheduled post:', error)
      return false
    }
  }

  /**
   * Reschedule a post to a new time
   */
  async reschedulePost(contentId: string, newTime: Date): Promise<SchedulingResult> {
    try {
      await prisma.content.update({
        where: { id: contentId },
        data: {
          scheduledAt: newTime
        }
      })

      return { success: true }
    } catch (error) {
      console.error('Failed to reschedule post:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Get scheduling statistics for a brand
   */
  async getSchedulingStats(brandId: string): Promise<any> {
    try {
      const stats = await prisma.content.groupBy({
        by: ['status'],
        where: { brandId },
        _count: { status: true }
      })

      const scheduled = await prisma.content.count({
        where: {
          brandId,
          status: 'approved',
          scheduledAt: { not: null }
        }
      })

      return {
        scheduled,
        posted: stats.find(s => s.status === 'posted')?._count.status || 0,
        failed: stats.find(s => s.status === 'failed')?._count.status || 0,
        pending: stats.find(s => s.status === 'pending')?._count.status || 0
      }
    } catch (error) {
      console.error('Failed to get scheduling stats:', error)
      return { scheduled: 0, posted: 0, failed: 0, pending: 0 }
    }
  }

  /**
   * Bulk schedule multiple content items
   */
  async bulkSchedule(contentIds: string[], startTime?: Date): Promise<SchedulingResult[]> {
    const results: SchedulingResult[] = []
    let currentTime = startTime || new Date()

    for (const contentId of contentIds) {
      const content = await prisma.content.findFirst({
        where: { id: contentId },
        include: { brand: true }
      })

      if (!content) {
        results.push({ success: false, error: 'Content not found' })
        continue
      }

      // Get optimal times for this brand
      const optimalTimes = await analyticsService.analyzeOptimalTimes(content.brandId)
      
      // Find next optimal time after currentTime
      let nextOptimalTime = new Date(currentTime)
      nextOptimalTime.setHours(optimalTimes[0].hour, 0, 0, 0)
      
      // If the optimal time for today has passed, move to next day
      if (nextOptimalTime <= currentTime) {
        nextOptimalTime.setDate(nextOptimalTime.getDate() + 1)
      }

      const result = await this.scheduleContent(contentId, nextOptimalTime)
      results.push(result)

      // Space out posts by at least 2 hours
      currentTime = new Date(nextOptimalTime.getTime() + 2 * 60 * 60 * 1000)
    }

    return results
  }
}

export const schedulerService = new SchedulerService()