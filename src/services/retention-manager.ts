import { PrismaClient } from '@prisma/client'
import { deleteExpiredImages } from './s3-image.js'
import { FastifyInstance } from 'fastify'
import type { EventBridgeScheduledEvent, LambdaResponse } from '../types/aws-events.js'

const prisma = new PrismaClient()

export class RetentionManager {
  private app: FastifyInstance
  private isRunning: boolean = false

  constructor(app: FastifyInstance) {
    this.app = app
  }

  /**
   * Initialize retention manager
   * Note: Scheduling is now handled by AWS EventBridge instead of node-cron
   */
  async initialize() {
    this.app.log.info('Retention Manager initialized - awaiting EventBridge triggers')
  }

  /**
   * Lambda handler for EventBridge scheduled retention processing
   * This will be triggered by EventBridge rules configured in AWS
   */
  async handleEventBridgeTrigger(event: EventBridgeScheduledEvent): Promise<LambdaResponse> {
    this.app.log.info('Retention processing triggered by EventBridge', {
      id: event.id,
      time: event.time,
      detailType: event['detail-type'],
      taskType: event.detail?.taskType,
    })

    try {
      const taskType = event.detail?.taskType || 'retention'
      
      if (taskType === 'retention') {
        await this.processExpiredContent()
      } else if (taskType === 'gdpr') {
        await this.processGDPRDeletions()
      }

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: `${taskType} processing completed`,
          eventId: event.id,
          executionTime: event.time,
        }),
      }
    } catch (error) {
      this.app.log.error({ error }, 'Error handling EventBridge trigger')
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Processing failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
      }
    }
  }

  /**
   * Process expired content based on retention policies
   */
  async processExpiredContent() {
    if (this.isRunning) {
      this.app.log.warn('Retention processing already in progress, skipping')
      return
    }

    this.isRunning = true
    try {
      this.app.log.info('Starting retention policy processing')

      // Find all content with expired retention
      const expiredContent = await prisma.content.findMany({
        where: {
          retentionExpiresAt: {
            lte: new Date()
          },
          s3ImageKey: {
            not: null
          }
        },
        select: {
          id: true,
          s3ImageKey: true,
          brandId: true,
          retentionExpiresAt: true
        }
      })

      if (expiredContent.length === 0) {
        this.app.log.info('No expired content found')
        return
      }

      this.app.log.info(`Found ${expiredContent.length} expired content items`)

      // Batch process deletions
      const batchSize = 10
      for (let i = 0; i < expiredContent.length; i += batchSize) {
        const batch = expiredContent.slice(i, i + batchSize)
        
        // Delete S3 images
        const s3Keys = batch
          .map(c => c.s3ImageKey)
          .filter((key): key is string => key !== null)
        
        if (s3Keys.length > 0) {
          await deleteExpiredImages(s3Keys)
        }

        // Update database records
        await prisma.content.updateMany({
          where: {
            id: {
              in: batch.map(c => c.id)
            }
          },
          data: {
            s3ImageKey: null,
            cdnImageUrl: null,
            imageUrl: null // Also clear original URL for full cleanup
          }
        })

        this.app.log.info(`Processed batch ${i / batchSize + 1} of ${Math.ceil(expiredContent.length / batchSize)}`)
      }

      this.app.log.info(`Retention processing complete: ${expiredContent.length} items processed`)
    } catch (error) {
      this.app.log.error({ error }, 'Error during retention processing')
    } finally {
      this.isRunning = false
    }
  }

  /**
   * Process GDPR deletion requests
   */
  async processGDPRDeletions() {
    try {
      this.app.log.info('Processing GDPR deletion requests')

      // Find users marked for deletion (you would need to add a deletionRequestedAt field)
      // For now, this is a placeholder implementation
      
      // In production, you would:
      // 1. Check for users with deletion requests
      // 2. Delete all their content and associated images
      // 3. Anonymize or delete user data
      // 4. Log the deletion for compliance

      this.app.log.info('GDPR deletion processing complete')
    } catch (error) {
      this.app.log.error({ error }, 'Error during GDPR deletion processing')
    }
  }

  /**
   * Delete all data for a specific user (GDPR right to be forgotten)
   */
  async deleteUserData(userId: string): Promise<{
    deletedContent: number
    deletedImages: number
    deletedBrands: number
  }> {
    try {
      this.app.log.info({ userId }, 'Processing user data deletion request')

      // Get all user's brands
      const brands = await prisma.brand.findMany({
        where: { userId },
        select: { id: true }
      })

      const brandIds = brands.map(b => b.id)

      // Get all content with S3 images
      const contentWithImages = await prisma.content.findMany({
        where: {
          brandId: {
            in: brandIds
          },
          s3ImageKey: {
            not: null
          }
        },
        select: {
          id: true,
          s3ImageKey: true
        }
      })

      // Delete S3 images
      const s3Keys = contentWithImages
        .map(c => c.s3ImageKey)
        .filter((key): key is string => key !== null)
      
      let deletedImages = 0
      if (s3Keys.length > 0) {
        await deleteExpiredImages(s3Keys)
        deletedImages = s3Keys.length
      }

      // Delete all content
      const deleteContentResult = await prisma.content.deleteMany({
        where: {
          brandId: {
            in: brandIds
          }
        }
      })

      // Delete all campaigns
      await prisma.campaign.deleteMany({
        where: {
          brandId: {
            in: brandIds
          }
        }
      })

      // Delete all brands
      const deleteBrandsResult = await prisma.brand.deleteMany({
        where: { userId }
      })

      // Delete campaign templates
      await prisma.campaignTemplate.deleteMany({
        where: { createdById: userId }
      })

      // Finally, delete the user
      await prisma.user.delete({
        where: { id: userId }
      })

      this.app.log.info({
        userId,
        deletedContent: deleteContentResult.count,
        deletedImages,
        deletedBrands: deleteBrandsResult.count
      }, 'User data deletion complete')

      return {
        deletedContent: deleteContentResult.count,
        deletedImages,
        deletedBrands: deleteBrandsResult.count
      }
    } catch (error) {
      this.app.log.error({ error, userId }, 'Failed to delete user data')
      throw new Error('Failed to process user data deletion')
    }
  }

  /**
   * Delete all data for a specific brand
   */
  async deleteBrandData(brandId: string): Promise<{
    deletedContent: number
    deletedImages: number
  }> {
    try {
      // Get all content with S3 images
      const contentWithImages = await prisma.content.findMany({
        where: {
          brandId,
          s3ImageKey: {
            not: null
          }
        },
        select: {
          id: true,
          s3ImageKey: true
        }
      })

      // Delete S3 images
      const s3Keys = contentWithImages
        .map(c => c.s3ImageKey)
        .filter((key): key is string => key !== null)
      
      let deletedImages = 0
      if (s3Keys.length > 0) {
        await deleteExpiredImages(s3Keys)
        deletedImages = s3Keys.length
      }

      // Delete all content
      const deleteContentResult = await prisma.content.deleteMany({
        where: { brandId }
      })

      // Delete all campaigns
      await prisma.campaign.deleteMany({
        where: { brandId }
      })

      this.app.log.info({
        brandId,
        deletedContent: deleteContentResult.count,
        deletedImages
      }, 'Brand data deletion complete')

      return {
        deletedContent: deleteContentResult.count,
        deletedImages
      }
    } catch (error) {
      this.app.log.error({ error, brandId }, 'Failed to delete brand data')
      throw new Error('Failed to process brand data deletion')
    }
  }

  /**
   * Manual trigger for retention processing
   */
  async triggerRetentionProcessing() {
    await this.processExpiredContent()
  }

  /**
   * Get retention statistics
   */
  async getRetentionStats() {
    const totalContent = await prisma.content.count({
      where: {
        s3ImageKey: {
          not: null
        }
      }
    })

    const expiringWithin30Days = await prisma.content.count({
      where: {
        retentionExpiresAt: {
          lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          gte: new Date()
        },
        s3ImageKey: {
          not: null
        }
      }
    })

    const expiredNotDeleted = await prisma.content.count({
      where: {
        retentionExpiresAt: {
          lte: new Date()
        },
        s3ImageKey: {
          not: null
        }
      }
    })

    const contentByRegion = await prisma.content.groupBy({
      by: ['imageRegion'],
      where: {
        s3ImageKey: {
          not: null
        }
      },
      _count: true
    })

    return {
      totalContent,
      expiringWithin30Days,
      expiredNotDeleted,
      contentByRegion: contentByRegion.map(r => ({
        region: r.imageRegion || 'unknown',
        count: r._count
      }))
    }
  }
}

// Singleton instance
let retentionManager: RetentionManager | null = null

export function getRetentionManager(app: FastifyInstance): RetentionManager {
  if (!retentionManager) {
    retentionManager = new RetentionManager(app)
  }
  return retentionManager
}