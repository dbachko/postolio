import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { prisma } from '../config/database.js';
import { generateInstagramContent, type ContentGenerationRequest } from './content-generator.js';
import { attachAssetToContent } from './assets-media.js';
import { getRedisUrl } from '../utils/redis-url.js';

// Fixed batch size as per product decision
const BATCH_SIZE = 5;

// Redis connection configuration using shared utility
const redisUrl = getRedisUrl();

const redisConnection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// Job data interface
interface RegenerationJobData {
  campaignId: string;
  contentIds: string[];
  userId: string;
  regenerationParams: {
    themes?: string[];
    style?: string;
    frequency?: string;
  };
}

// Job progress interface
interface RegenerationProgress {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  total: number;
  completed: number;
  failed: number;
  errors?: string[];
}

// Create regeneration queue
export const regenerationQueue = new Queue('content-regeneration', {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 20,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

// Queue processor worker
const regenerationWorker = new Worker(
  'content-regeneration',
  async (job: Job<RegenerationJobData>) => {
    const { campaignId, contentIds, regenerationParams } = job.data;

    console.log(
      `Starting regeneration job for campaign ${campaignId} with ${contentIds.length} items`
    );

    const results = {
      completed: 0,
      failed: 0,
      errors: [] as string[],
    };

    // Process content in batches of fixed size
    for (let i = 0; i < contentIds.length; i += BATCH_SIZE) {
      const batch = contentIds.slice(i, i + BATCH_SIZE);

      // Process batch concurrently
      const batchPromises = batch.map(async (contentId) => {
        try {
          // Get existing content
          const existingContent = await prisma.content.findUnique({
            where: { id: contentId },
            include: { brand: true },
          });

          if (!existingContent) {
            throw new Error(`Content ${contentId} not found`);
          }

          // Generate new content with regeneration parameters
          const contentRequest: ContentGenerationRequest = {
            brandId: existingContent.brandId,
            count: 1,
            theme: regenerationParams.themes?.[0] || 'lifestyle',
            style: regenerationParams.style,
            campaignId,
          };

          const newContentArray = await generateInstagramContent(
            existingContent.brand.name,
            contentRequest
          );

          if (!newContentArray || newContentArray.length === 0) {
            throw new Error('Failed to generate content');
          }

          const newContent = newContentArray[0];

          if (!newContent) {
            throw new Error('No content generated');
          }

          // Update existing content with new generated data
          await prisma.content.update({
            where: { id: contentId },
            data: {
              caption: newContent.caption,
              hashtags: newContent.hashtags,
              generationParams: {
                ...(((existingContent.generationParams as unknown) &&
                typeof existingContent.generationParams === 'object'
                  ? (existingContent.generationParams as Record<string, unknown>)
                  : {}) || {}),
                regeneratedAt: new Date().toISOString(),
                regenerationReason: 'campaign-edit',
                originalParams: existingContent.generationParams,
                newTheme: regenerationParams.themes?.[0],
                newStyle: regenerationParams.style,
                imagePrompt: newContent.imagePrompt,
              },
            },
          });

          if (newContent.asset) {
            await attachAssetToContent({ contentId, asset: newContent.asset });
          }

          results.completed++;
          return { contentId, status: 'success' };
        } catch (error) {
          results.failed++;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          results.errors.push(`Content ${contentId}: ${errorMessage}`);
          console.error(`Failed to regenerate content ${contentId}:`, error);
          return { contentId, status: 'failed', error: errorMessage };
        }
      });

      // Wait for batch to complete
      await Promise.allSettled(batchPromises);

      // Update job progress
      const progress = Math.floor(((i + batch.length) / contentIds.length) * 100);
      await job.updateProgress(progress);

      console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1} completed. Progress: ${progress}%`);
    }

    // Update campaign status if regeneration completed
    if (results.failed === 0) {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: {
          status: 'preview',
          errorMessage: null,
        },
      });
    } else if (results.completed === 0) {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: {
          status: 'failed',
          errorMessage: `All content regeneration failed. Errors: ${results.errors.join('; ')}`,
        },
      });
    } else {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: {
          status: 'preview',
          errorMessage: `Partial regeneration completed. ${results.failed} items failed: ${results.errors.join('; ')}`,
        },
      });
    }

    console.log(
      `Regeneration job completed for campaign ${campaignId}. Completed: ${results.completed}, Failed: ${results.failed}`
    );

    return {
      campaignId,
      total: contentIds.length,
      completed: results.completed,
      failed: results.failed,
      errors: results.errors,
    };
  },
  {
    connection: redisConnection,
    concurrency: 1, // Process one regeneration job at a time
  }
);

// Regeneration service class
export class RegenerationService {
  /**
   * Start content regeneration for a campaign
   */
  async startRegeneration(
    campaignId: string,
    contentIds: string[],
    userId: string,
    regenerationParams: RegenerationJobData['regenerationParams'] = {}
  ): Promise<{ jobId: string; totalContent: number; estimatedTime: number }> {
    // Add job to queue
    const job = await regenerationQueue.add('regenerate-content', {
      campaignId,
      contentIds,
      userId,
      regenerationParams,
    });

    // Estimate time based on content count (approximately 5-10 seconds per item)
    const estimatedTime = Math.ceil(contentIds.length * 7.5); // seconds

    console.log(
      `Queued regeneration job ${job.id} for campaign ${campaignId} with ${contentIds.length} items`
    );

    return {
      jobId: job.id as string,
      totalContent: contentIds.length,
      estimatedTime,
    };
  }

  /**
   * Get regeneration job progress
   */
  async getJobProgress(jobId: string, userId?: string): Promise<RegenerationProgress | null> {
    try {
      const job = await Job.fromId(regenerationQueue, jobId);

      if (!job) {
        return null;
      }

      // Authorization check: verify user owns this job
      if (userId) {
        const jobData = job.data as RegenerationJobData;
        if (jobData.userId !== userId) {
          return null; // User doesn't own this job
        }
      }

      const progress = (job.progress as number) || 0;
      const state = await job.getState();

      // Extract data from job
      const { contentIds } = job.data as RegenerationJobData;
      const total = contentIds.length;
      const completed = Math.floor((progress / 100) * total);

      let status: RegenerationProgress['status'] = 'pending';
      if (state === 'completed') status = 'completed';
      else if (state === 'failed') status = 'failed';
      else if (state === 'active') status = 'processing';

      const result: RegenerationProgress = {
        status,
        progress,
        total,
        completed,
        failed: 0, // Will be updated from job results when completed
      };

      if (job.failedReason) {
        result.errors = [job.failedReason];
      }

      return result;
    } catch (error) {
      console.error(`Error getting job progress for ${jobId}:`, error);
      return null;
    }
  }

  /**
   * Cancel a regeneration job
   */
  async cancelJob(jobId: string, userId?: string): Promise<boolean> {
    try {
      const job = await Job.fromId(regenerationQueue, jobId);
      if (job) {
        // Authorization check: verify user owns this job
        if (userId) {
          const jobData = job.data as RegenerationJobData;
          if (jobData.userId !== userId) {
            return false; // User doesn't own this job
          }
        }

        await job.remove();
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Error canceling job ${jobId}:`, error);
      return false;
    }
  }

  /**
   * Get queue status
   */
  async getQueueStatus() {
    const waiting = await regenerationQueue.getWaiting();
    const active = await regenerationQueue.getActive();
    const completed = await regenerationQueue.getCompleted();
    const failed = await regenerationQueue.getFailed();

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
    };
  }
}

// Export singleton instance
export const regenerationService = new RegenerationService();

// Cleanup function
export async function cleanup() {
  await regenerationWorker.close();
  await regenerationQueue.close();
  redisConnection.disconnect();
}

// Handle process termination
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
