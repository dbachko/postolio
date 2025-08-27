import Bull from 'bull'
import { PrismaClient } from '@prisma/client'
import { getDatabaseClient } from '../config/database.js'
import Redis from 'ioredis'

const prisma = getDatabaseClient()

// Deletion job types
export interface DeletionJob {
  userId: string
  scheduledDeletionDate: Date
  email: string
}

export interface DeletionJobResult {
  success: boolean
  userId: string
  deletedAt: Date
  error?: string
}

export class DeletionQueueService {
  private static instance: DeletionQueueService | null = null
  private deletionQueue: Bull.Queue<DeletionJob>
  private redis: Redis

  private constructor() {
    // Create Redis connection for Bull
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      family: 4, // Force IPv4
    })

    // Create Bull queue
    const redisConfig = process.env.REDIS_URL 
      ? process.env.REDIS_URL
      : {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),
          db: parseInt(process.env.REDIS_DB || '0'),
        }

    this.deletionQueue = new Bull('user-deletion', {
      redis: redisConfig,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000, // Start with 2 seconds
        },
      },
    })

    // Process deletion jobs
    this.deletionQueue.process('permanent-deletion', 5, async (job: Bull.Job<DeletionJob>) => {
      console.log('Processing deletion job:', job.id)
      
      try {
        const { userId, scheduledDeletionDate } = job.data
        
        // Check if the scheduled deletion date has passed
        if (new Date() < new Date(scheduledDeletionDate)) {
          // Not time yet, re-schedule for the scheduled deletion date
          const delay = new Date(scheduledDeletionDate).getTime() - Date.now()
          await this.scheduleDeletion(job.data, delay)
          return { success: false, userId, error: 'Not time for deletion yet' } as DeletionJobResult
        }

        // Perform permanent deletion
        const result = await this.permanentlyDeleteUser(userId)
        
        return {
          success: true,
          userId,
          deletedAt: new Date(),
        } as DeletionJobResult
      } catch (error) {
        console.error('Deletion job failed:', error)
        throw error // Will trigger retry
      }
    })

    // Daily cron job to check for scheduled deletions
    this.setupDailyCron()
  }

  static getInstance(): DeletionQueueService {
    if (!DeletionQueueService.instance) {
      DeletionQueueService.instance = new DeletionQueueService()
    }
    return DeletionQueueService.instance
  }

  private async permanentlyDeleteUser(userId: string): Promise<void> {
    // Use transaction to ensure all data is deleted
    await prisma.$transaction(async (tx) => {
      // Delete all related data first (cascade delete)
      
      // Delete content
      await tx.content.deleteMany({
        where: {
          brand: {
            userId
          }
        }
      })
      
      // Delete campaigns
      await tx.campaign.deleteMany({
        where: {
          brand: {
            userId
          }
        }
      })
      
      // Delete brands
      await tx.brand.deleteMany({
        where: { userId }
      })
      
      // Delete campaign templates
      await tx.campaignTemplate.deleteMany({
        where: { createdById: userId }
      })
      
      // Finally delete the user
      await tx.user.delete({
        where: { id: userId }
      })
    })
  }

  async scheduleDeletion(data: DeletionJob, delay: number = 0): Promise<Bull.Job<DeletionJob>> {
    const jobOptions: Bull.JobOptions = {
      delay: delay > 0 ? delay : 0,
      priority: 1, // Low priority
    }

    return this.deletionQueue.add('permanent-deletion', data, jobOptions)
  }

  private setupDailyCron(): void {
    // Run every day at 2 AM to check for scheduled deletions
    this.deletionQueue.add(
      'check-scheduled-deletions',
      {},
      {
        repeat: {
          cron: '0 2 * * *', // 2 AM daily
        },
      }
    )

    this.deletionQueue.process('check-scheduled-deletions', async () => {
      console.log('Checking for scheduled deletions...')
      
      // Find all users scheduled for deletion
      const usersToDelete = await prisma.user.findMany({
        where: {
          deletedAt: { not: null },
          scheduledDeletion: { lte: new Date() }
        }
      })

      console.log(`Found ${usersToDelete.length} users scheduled for deletion`)

      // Schedule deletion jobs for each user
      for (const user of usersToDelete) {
        await this.scheduleDeletion({
          userId: user.id,
          scheduledDeletionDate: user.scheduledDeletion!,
          email: user.email
        })
      }
    })
  }

  async getJobStatus(jobId: string): Promise<Bull.Job<DeletionJob> | null> {
    return this.deletionQueue.getJob(jobId)
  }

  async getQueueStatus(): Promise<{
    waiting: number
    active: number
    completed: number
    failed: number
  }> {
    const [waiting, active, completed, failed] = await Promise.all([
      this.deletionQueue.getWaitingCount(),
      this.deletionQueue.getActiveCount(),
      this.deletionQueue.getCompletedCount(),
      this.deletionQueue.getFailedCount(),
    ])

    return { waiting, active, completed, failed }
  }

  async close(): Promise<void> {
    await this.deletionQueue.close()
    this.redis.disconnect()
  }
}

// Export singleton instance
export const deletionQueueService = DeletionQueueService.getInstance()