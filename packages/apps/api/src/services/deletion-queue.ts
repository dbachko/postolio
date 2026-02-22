import Bull from 'bull';
import { logger as baseLogger } from '@postolio/logger';
import { getDatabaseClient } from '../config/database.js';
import type { Redis } from 'ioredis';
import { getRedisUrl } from '../utils/redis-url.js';
import { createRedisClient } from './redis.js';

const prisma = getDatabaseClient();

// Deletion job types
export interface DeletionJob {
  userId: string;
  scheduledDeletionDate: Date;
  email: string;
}

export interface DeletionJobResult {
  success: boolean;
  userId: string;
  deletedAt: Date;
  error?: string;
}

export class DeletionQueueService {
  private static instance: DeletionQueueService | null = null;
  private deletionQueue: Bull.Queue<DeletionJob>;
  private redis: Redis;
  private logger = baseLogger.child({ module: 'deletion-queue' });

  private constructor() {
    // Use shared utility for Redis URL construction
    const redisUrl = getRedisUrl();

    // Create Redis connection for Bull
    this.redis = createRedisClient({
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      family: 4, // Force IPv4
    });

    // Create Bull queue - use same URL for consistency
    const redisConfig = redisUrl;

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
    });

    // Process deletion jobs
    this.deletionQueue.process('permanent-deletion', 5, async (job: Bull.Job<DeletionJob>) => {
      this.logger.info('Processing deletion job', { jobId: job.id });

      try {
        const { userId, scheduledDeletionDate } = job.data;

        // Check if the scheduled deletion date has passed
        if (new Date() < new Date(scheduledDeletionDate)) {
          // Not time yet, re-schedule for the scheduled deletion date
          const delay = new Date(scheduledDeletionDate).getTime() - Date.now();
          await this.scheduleDeletion(job.data, delay);
          return {
            success: false,
            userId,
            error: 'Not time for deletion yet',
          } as DeletionJobResult;
        }

        // Perform permanent deletion
        await this.permanentlyDeleteUser(userId);

        return {
          success: true,
          userId,
          deletedAt: new Date(),
        } as DeletionJobResult;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.error('Deletion job failed', {
          jobId: job.id,
          error: { name: err.name, message: err.message, stack: err.stack },
        });
        throw error; // Will trigger retry
      }
    });

    // Daily cron job to check for scheduled deletions
    this.setupDailyCron();
  }

  static getInstance(): DeletionQueueService {
    if (!DeletionQueueService.instance) {
      DeletionQueueService.instance = new DeletionQueueService();
    }
    return DeletionQueueService.instance;
  }

  private async permanentlyDeleteUser(userId: string): Promise<void> {
    // Use transaction to ensure all data is deleted
    await prisma.$transaction(async (tx) => {
      // Delete all related data first (cascade delete)

      // Delete content
      await tx.content.deleteMany({
        where: {
          brand: {
            userId,
          },
        },
      });

      // Delete brands
      await tx.brand.deleteMany({
        where: { userId },
      });

      // Finally delete the user
      await tx.user.delete({
        where: { id: userId },
      });
    });
  }

  async scheduleDeletion(data: DeletionJob, delay = 0): Promise<Bull.Job<DeletionJob>> {
    const jobOptions: Bull.JobOptions = {
      delay: delay > 0 ? delay : 0,
      priority: 1, // Low priority
    };

    return this.deletionQueue.add('permanent-deletion', data, jobOptions);
  }

  /**
   * Scan for users whose scheduled deletion date has passed
   * and enqueue permanent deletion jobs for them.
   */
  async sweepScheduledDeletions(): Promise<{
    scheduledCount: number;
  }> {
    this.logger.info('Checking for scheduled deletions');

    const usersToDelete = await prisma.user.findMany({
      where: {
        deletedAt: { not: null },
        scheduledDeletion: { lte: new Date() },
      },
    });

    this.logger.info('Scheduled deletions discovered', {
      count: usersToDelete.length,
    });

    let scheduledCount = 0;

    for (const user of usersToDelete) {
      await this.scheduleDeletion({
        userId: user.id,
        scheduledDeletionDate: user.scheduledDeletion!,
        email: user.email,
      });
      scheduledCount += 1;
    }

    return { scheduledCount };
  }

  private setupDailyCron(): void {
    // Run every day at 2 AM to check for scheduled deletions
    this.deletionQueue.add(
      'check-scheduled-deletions',
      {
        userId: '',
        scheduledDeletionDate: new Date(),
        email: '',
      } as DeletionJob,
      {
        repeat: {
          cron: '0 2 * * *', // 2 AM daily
        },
      }
    );

    this.deletionQueue.process('check-scheduled-deletions', async () => {
      return this.sweepScheduledDeletions();
    });
  }

  async getJobStatus(jobId: string): Promise<Bull.Job<DeletionJob> | null> {
    return this.deletionQueue.getJob(jobId);
  }

  async getQueueStatus(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    const [waiting, active, completed, failed] = await Promise.all([
      this.deletionQueue.getWaitingCount(),
      this.deletionQueue.getActiveCount(),
      this.deletionQueue.getCompletedCount(),
      this.deletionQueue.getFailedCount(),
    ]);

    return { waiting, active, completed, failed };
  }

  async close(): Promise<void> {
    await this.deletionQueue.close();
    this.redis.disconnect();
  }
}

// Export singleton instance
export const deletionQueueService = DeletionQueueService.getInstance();
