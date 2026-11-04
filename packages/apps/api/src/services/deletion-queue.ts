import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import { logger as baseLogger } from '@postolio/logger';
import { getDatabaseClient } from '../config/database.js';
import { getQueueOptions } from './queue-config.js';

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
  private deletionQueue: Queue<DeletionJob>;
  private worker: Worker<DeletionJob>;
  private logger = baseLogger.child({ module: 'deletion-queue' });

  private constructor() {
    this.deletionQueue = new Queue<DeletionJob>('user-deletion', {
      ...getQueueOptions(),
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

    const processPermanentDeletion = async (job: Job<DeletionJob>) => {
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
    };

    // Bull added concurrency per named processor: 5 + 1.
    this.worker = new Worker<DeletionJob>(
      'user-deletion',
      async (job) =>
        job.name === 'check-scheduled-deletions'
          ? this.sweepScheduledDeletions()
          : processPermanentDeletion(job),
      { ...getQueueOptions(), concurrency: 6 }
    );

    const logQueueError = (err: Error) => {
      this.logger.error('Deletion queue error', { error: err.message });
    };
    this.deletionQueue.on('error', logQueueError);
    this.worker.on('error', logQueueError);

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

  async scheduleDeletion(data: DeletionJob, delay = 0): Promise<Job<DeletionJob>> {
    const jobOptions: JobsOptions = {
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
    void this.deletionQueue
      .upsertJobScheduler(
        'check-scheduled-deletions',
        { pattern: '0 2 * * *' },
        {
          name: 'check-scheduled-deletions',
          data: { userId: '', scheduledDeletionDate: new Date(), email: '' } as DeletionJob,
        }
      )
      .catch((err: Error) => {
        this.logger.error('Failed to schedule deletion sweep', { error: err.message });
      });
  }

  async getJobStatus(jobId: string): Promise<Job<DeletionJob> | null> {
    return (await this.deletionQueue.getJob(jobId)) ?? null;
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
    await this.worker.close();
    await this.deletionQueue.close();
  }
}

// Export singleton instance
export const deletionQueueService = DeletionQueueService.getInstance();
