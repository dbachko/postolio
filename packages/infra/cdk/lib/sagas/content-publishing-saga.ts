/**
 * Content Publishing Saga
 * Manages the distributed transaction for publishing content across platforms
 */

import { SagaOrchestrator, SagaContext } from '../patterns/saga-orchestrator';
import { EventBusService } from '../services/event-bus-service';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import axios from 'axios';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const ssmClient = new SSMClient({});
const eventBus = EventBusService.getInstance();

const SCHEDULE_TABLE = process.env.SCHEDULE_TABLE_NAME || 'schedules';
const MAIN_APP_URL = process.env.MAIN_APP_URL || 'http://localhost:3000';

export interface ContentPublishingContext extends SagaContext {
  contentId: string;
  scheduleId: string;
  platform: 'instagram' | 'facebook' | 'linkedin' | 'tiktok';
  content: {
    caption: string;
    hashtags: string[];
    mediaUrl?: string;
  };
  platformPostId?: string;
  permalink?: string;
}

export class ContentPublishingSaga {
  private saga: SagaOrchestrator<ContentPublishingContext>;

  constructor() {
    this.saga = new SagaOrchestrator<ContentPublishingContext>('content-publishing');
    this.configureSaga();
  }

  private configureSaga() {
    // Step 1: Update content status to processing
    this.saga.addStep({
      name: 'updateContentStatus',
      service: 'content-service',
      forward: async (ctx) => {
        console.log(`Updating content ${ctx.contentId} status to processing`);

        // Update in main app via API
        const response = await axios.patch(
          `${MAIN_APP_URL}/api/content/${ctx.contentId}/status`,
          { status: 'processing' },
          {
            headers: {
              'x-correlation-id': ctx.correlationId,
              'x-user-id': ctx.userId,
            },
          }
        );

        return response.data;
      },
      compensate: async (ctx) => {
        console.log(`Reverting content ${ctx.contentId} status to scheduled`);

        await axios.patch(
          `${MAIN_APP_URL}/api/content/${ctx.contentId}/status`,
          { status: 'scheduled' },
          {
            headers: {
              'x-correlation-id': ctx.correlationId,
              'x-user-id': ctx.userId,
            },
          }
        );
      },
      retryable: true,
      maxRetries: 3,
      timeout: 10000,
    });

    // Step 2: Get fresh token from token service
    this.saga.addStep({
      name: 'getToken',
      service: 'token-service',
      forward: async (ctx) => {
        console.log(`Getting token for brand ${ctx.brandId} on ${ctx.platform}`);

        // Get token service endpoint from SSM Parameter Store
        const environment = process.env.NODE_ENV || 'dev';
        const parameterName = `/postolio/${environment}/services/token-service/url`;
        const parameterResponse = await ssmClient.send(
          new GetParameterCommand({ Name: parameterName })
        );
        const tokenServiceUrl = parameterResponse.Parameter?.Value;

        if (!tokenServiceUrl) {
          throw new Error(`Token service URL not found in parameter ${parameterName}`);
        }

        // Fetch token from token service (Lambda or API)
        const response = await axios.get(
          `${tokenServiceUrl}/tokens/${ctx.userId}/${ctx.brandId}/${ctx.platform}`,
          {
            headers: {
              'x-correlation-id': ctx.correlationId,
            },
          }
        );

        if (!response.data.token) {
          throw new Error(`No valid token for ${ctx.platform}`);
        }

        return response.data.token;
      },
      compensate: async () => {
        // No compensation needed for token fetch
      },
      retryable: true,
      maxRetries: 2,
      timeout: 5000,
    });

    // Step 3: Publish to platform
    this.saga.addStep({
      name: 'publishToPlatform',
      service: 'publisher-service',
      forward: async (ctx) => {
        console.log(`Publishing to ${ctx.platform}`);

        const token = ctx['getTokenResult'];

        // Call platform-specific publisher Lambda
        const publisherUrl = `${process.env.PUBLISHER_SERVICE_URL}/${ctx.platform}/publish`;
        const response = await axios.post(
          publisherUrl,
          {
            content: ctx.content,
            token: token,
            brandId: ctx.brandId,
          },
          {
            headers: {
              'x-correlation-id': ctx.correlationId,
            },
          }
        );

        // Store platform post ID for potential rollback
        ctx.platformPostId = response.data.postId;
        ctx.permalink = response.data.permalink;

        return response.data;
      },
      compensate: async (ctx, result: any) => {
        if (result?.postId) {
          console.log(`Deleting post ${result.postId} from ${ctx.platform}`);

          try {
            await axios.delete(
              `${process.env.PUBLISHER_SERVICE_URL}/${ctx.platform}/posts/${result.postId}`,
              {
                headers: {
                  'x-correlation-id': ctx.correlationId,
                },
              }
            );
          } catch (error) {
            console.error('Failed to delete post from platform', error);
            // Continue with compensation even if deletion fails
          }
        }
      },
      retryable: true,
      maxRetries: 3,
      timeout: 30000,
    });

    // Step 4: Update schedule status
    this.saga.addStep({
      name: 'updateScheduleStatus',
      service: 'scheduler-service',
      forward: async (ctx) => {
        console.log(`Updating schedule ${ctx.scheduleId} to published`);

        await docClient.send(
          new UpdateCommand({
            TableName: SCHEDULE_TABLE,
            Key: { scheduleId: ctx.scheduleId },
            UpdateExpression:
              'SET #status = :status, publishedAt = :publishedAt, platformPostId = :postId, permalink = :permalink',
            ExpressionAttributeNames: {
              '#status': 'status',
            },
            ExpressionAttributeValues: {
              ':status': 'published',
              ':publishedAt': new Date().toISOString(),
              ':postId': ctx.platformPostId,
              ':permalink': ctx.permalink,
            },
          })
        );

        return { status: 'published' };
      },
      compensate: async (ctx) => {
        console.log(`Reverting schedule ${ctx.scheduleId} to scheduled`);

        await docClient.send(
          new UpdateCommand({
            TableName: SCHEDULE_TABLE,
            Key: { scheduleId: ctx.scheduleId },
            UpdateExpression:
              'SET #status = :status, REMOVE publishedAt, platformPostId, permalink',
            ExpressionAttributeNames: {
              '#status': 'status',
            },
            ExpressionAttributeValues: {
              ':status': 'scheduled',
            },
          })
        );
      },
      retryable: true,
      maxRetries: 3,
    });

    // Step 5: Update content with platform data
    this.saga.addStep({
      name: 'updateContentWithPlatformData',
      service: 'content-service',
      forward: async (ctx) => {
        console.log(`Updating content ${ctx.contentId} with platform data`);

        await axios.patch(
          `${MAIN_APP_URL}/api/content/${ctx.contentId}`,
          {
            status: 'published',
            platformPostId: ctx.platformPostId,
            permalink: ctx.permalink,
            publishedAt: new Date().toISOString(),
          },
          {
            headers: {
              'x-correlation-id': ctx.correlationId,
              'x-user-id': ctx.userId,
            },
          }
        );

        return { updated: true };
      },
      compensate: async (ctx) => {
        console.log(`Removing platform data from content ${ctx.contentId}`);

        await axios.patch(
          `${MAIN_APP_URL}/api/content/${ctx.contentId}`,
          {
            status: 'scheduled',
            platformPostId: null,
            permalink: null,
            publishedAt: null,
          },
          {
            headers: {
              'x-correlation-id': ctx.correlationId,
              'x-user-id': ctx.userId,
            },
          }
        );
      },
      retryable: true,
      maxRetries: 3,
    });

    // Step 6: Publish success event
    this.saga.addStep({
      name: 'publishSuccessEvent',
      service: 'event-bus',
      forward: async (ctx) => {
        console.log(`Publishing post.published event`);

        await eventBus.publish(
          'post.published',
          {
            scheduleId: ctx.scheduleId,
            contentId: ctx.contentId,
            brandId: ctx.brandId,
            platform: ctx.platform,
            platformPostId: ctx.platformPostId!,
            permalink: ctx.permalink!,
            publishedAt: new Date().toISOString(),
          },
          {
            correlationId: ctx.correlationId,
            userId: ctx.userId,
            brandId: ctx.brandId,
          }
        );

        return { eventPublished: true };
      },
      compensate: async (ctx) => {
        // Publish failure event
        await eventBus.publish(
          'post.unpublished',
          {
            scheduleId: ctx.scheduleId,
            contentId: ctx.contentId,
            brandId: ctx.brandId,
            platform: ctx.platform,
            reason: 'Saga compensation',
          },
          {
            correlationId: ctx.correlationId,
            userId: ctx.userId,
            brandId: ctx.brandId,
          }
        );
      },
      retryable: true,
      maxRetries: 2,
    });
  }

  /**
   * Execute the content publishing saga
   */
  async execute(context: ContentPublishingContext): Promise<ContentPublishingContext> {
    console.log(`Starting content publishing saga for content ${context.contentId}`);

    try {
      const result = await this.saga.execute(context);

      console.log(`Content publishing saga completed successfully`, {
        contentId: context.contentId,
        platformPostId: result.platformPostId,
        permalink: result.permalink,
      });

      return result;
    } catch (error) {
      console.error(`Content publishing saga failed`, error);

      // Publish failure event
      await eventBus.publish(
        'post.failed',
        {
          scheduleId: context.scheduleId,
          contentId: context.contentId,
          brandId: context.brandId,
          platform: context.platform,
          error: {
            code: 'SAGA_FAILED',
            message: error instanceof Error ? error.message : 'Unknown error',
            retryable: false,
          },
          attemptNumber: 1,
        },
        {
          correlationId: context.correlationId,
          userId: context.userId,
          brandId: context.brandId,
        }
      );

      throw error;
    }
  }
}
