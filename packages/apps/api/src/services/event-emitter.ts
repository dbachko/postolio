/**
 * EventBridge Event Emitter Service
 * Emits events to AWS EventBridge for microservices communication
 */

import { EventBridge, PutEventsCommandOutput } from '@aws-sdk/client-eventbridge';
import { logger as baseLogger } from '@postolio/logger';
import { formatError } from '../utils/logging.js';

export class EventEmitter {
  private eventBridge: EventBridge;
  private static instance: EventEmitter | null = null;
  private logger = baseLogger.child({ module: 'event-emitter' });

  constructor() {
    // Initialize EventBridge client
    // Will use default credentials from environment or IAM role
    this.eventBridge = new EventBridge({
      region: process.env.AWS_REGION || 'us-east-1',
    });
  }

  /**
   * Emit brand learning applied event to be consumed by brand-analysis pipeline
   */
  async emitBrandLearningApplied(
    brandId: string,
    payload: {
      insights: Array<{
        pattern: string;
        confidence: number;
        category: string;
        recommendation?: string;
      }>;
      profileUpdates: Array<{
        field: string;
        newValue: unknown;
        confidence?: number;
        reasoning?: string;
      }>;
      appliedToFuturePosts?: number;
      editAnalysis?: unknown;
      triggeredBy?: { userId?: string; contentId?: string };
    }
  ): Promise<void> {
    try {
      const result = await this.eventBridge.putEvents({
        Entries: [
          {
            Source: 'postolio.brand',
            DetailType: 'brand.learning.applied',
            Detail: JSON.stringify({
              brandId,
              ...payload,
              timestamp: new Date().toISOString(),
            }),
            EventBusName: process.env.EVENT_BUS_NAME || 'default',
          },
        ],
      });

      this.logPutEventsResult(
        result,
        '🧠 Brand learning event emitted',
        'Failed to emit brand learning applied event',
        { brandId }
      );
    } catch (error) {
      this.logger.error('Error emitting brand learning applied event', {
        brandId,
        ...formatError(error),
      });
    }
  }

  /**
   * Get singleton instance
   */
  static getInstance(): EventEmitter {
    if (!EventEmitter.instance) {
      EventEmitter.instance = new EventEmitter();
    }
    return EventEmitter.instance;
  }

  /**
   * Emit content updated event
   */
  async emitContentUpdated(
    contentId: string,
    brandId: string,
    userId: string,
    updates: {
      caption?: string;
      hashtags?: string[];
      imageUrl?: string;
    },
    version: number = 1
  ): Promise<void> {
    try {
      const result = await this.eventBridge.putEvents({
        Entries: [
          {
            Source: 'postolio.content',
            DetailType: 'content.updated',
            Detail: JSON.stringify({
              contentId,
              brandId,
              userId,
              updates,
              version,
              timestamp: new Date().toISOString(),
            }),
            EventBusName: process.env.EVENT_BUS_NAME || 'default',
          },
        ],
      });

      this.logPutEventsResult(
        result,
        'Content updated event emitted',
        'Failed to emit content updated event',
        { contentId, brandId }
      );
    } catch (error) {
      // Log error but don't fail the request
      this.logger.error('Error emitting content updated event', {
        contentId,
        brandId,
        ...formatError(error),
      });
    }
  }

  /**
   * Emit content published event
   */
  async emitContentPublished(
    contentId: string,
    brandId: string,
    platform: string,
    platformPostId: string,
    platformUrl: string
  ): Promise<void> {
    try {
      const result = await this.eventBridge.putEvents({
        Entries: [
          {
            Source: 'postolio.content',
            DetailType: 'content.published',
            Detail: JSON.stringify({
              contentId,
              brandId,
              platform,
              platformPostId,
              platformUrl,
              publishedAt: new Date().toISOString(),
            }),
            EventBusName: process.env.EVENT_BUS_NAME || 'default',
          },
        ],
      });

      this.logPutEventsResult(
        result,
        'Content published event emitted',
        'Failed to emit content published event',
        { contentId, brandId, platform }
      );
    } catch (error) {
      this.logger.error('Error emitting content published event', {
        contentId,
        brandId,
        ...formatError(error),
      });
    }
  }

  /**
   * Emit content scheduled event
   */
  async emitContentScheduled(
    contentId: string,
    brandId: string,
    scheduleId: string,
    scheduledAt: string
  ): Promise<void> {
    try {
      const result = await this.eventBridge.putEvents({
        Entries: [
          {
            Source: 'postolio.content',
            DetailType: 'content.scheduled',
            Detail: JSON.stringify({
              contentId,
              brandId,
              scheduleId,
              scheduledAt,
              timestamp: new Date().toISOString(),
            }),
            EventBusName: process.env.EVENT_BUS_NAME || 'default',
          },
        ],
      });

      this.logPutEventsResult(
        result,
        'Content scheduled event emitted',
        'Failed to emit content scheduled event',
        { contentId, brandId, scheduleId }
      );
    } catch (error) {
      this.logger.error('Error emitting content scheduled event', {
        contentId,
        brandId,
        ...formatError(error),
      });
    }
  }

  /**
   * Emit content scheduling failed event
   */
  async emitContentSchedulingFailed(
    contentId: string,
    brandId: string,
    error: string
  ): Promise<void> {
    try {
      const result = await this.eventBridge.putEvents({
        Entries: [
          {
            Source: 'postolio.content',
            DetailType: 'content.scheduling.failed',
            Detail: JSON.stringify({
              contentId,
              brandId,
              error,
              timestamp: new Date().toISOString(),
            }),
            EventBusName: process.env.EVENT_BUS_NAME || 'default',
          },
        ],
      });

      this.logPutEventsResult(
        result,
        'Content scheduling failed event emitted',
        'Failed to emit content scheduling failed event',
        { contentId, brandId }
      );
    } catch (error) {
      this.logger.error('Error emitting content scheduling failed event', {
        contentId,
        brandId,
        ...formatError(error),
      });
    }
  }

  /**
   * Emit campaign status changed event for microservices
   */
  async emitCampaignStatusChanged(
    campaignId: string,
    brandId: string,
    oldStatus: string,
    newStatus: string,
    triggeredBy?: {
      userId?: string;
      operation?: string;
    }
  ): Promise<void> {
    try {
      const result = await this.eventBridge.putEvents({
        Entries: [
          {
            Source: 'postolio.campaign',
            DetailType: 'campaign.status.changed',
            Detail: JSON.stringify({
              campaignId,
              brandId,
              oldStatus,
              newStatus,
              triggeredBy,
              timestamp: new Date().toISOString(),
            }),
            EventBusName: process.env.EVENT_BUS_NAME || 'default',
          },
        ],
      });

      this.logPutEventsResult(
        result,
        'Campaign status event emitted',
        'Failed to emit campaign status changed event',
        { campaignId, brandId, oldStatus, newStatus }
      );
    } catch (error) {
      // Log error but don't fail the request - this is non-blocking
      this.logger.error('Error emitting campaign status changed event', {
        campaignId,
        brandId,
        ...formatError(error),
      });
    }
  }

  /**
   * Emit campaign created event for microservices
   */
  async emitCampaignCreated(
    campaignId: string,
    brandId: string,
    status: string,
    triggeredBy?: {
      userId?: string;
      operation?: string;
    }
  ): Promise<void> {
    try {
      const result = await this.eventBridge.putEvents({
        Entries: [
          {
            Source: 'postolio.campaign',
            DetailType: 'campaign.created',
            Detail: JSON.stringify({
              campaignId,
              brandId,
              status,
              triggeredBy,
              timestamp: new Date().toISOString(),
            }),
            EventBusName: process.env.EVENT_BUS_NAME || 'default',
          },
        ],
      });

      this.logPutEventsResult(
        result,
        'Campaign created event emitted',
        'Failed to emit campaign created event',
        { campaignId, brandId, status }
      );
    } catch (error) {
      // Log error but don't fail the request - this is non-blocking
      this.logger.error('Error emitting campaign created event', {
        campaignId,
        brandId,
        ...formatError(error),
      });
    }
  }

  /**
   * Emit content-campaign association event for tracking validation coverage
   */
  async emitCampaignContentAssociated(
    campaignId: string,
    contentId: string,
    brandId: string,
    triggeredBy?: {
      userId?: string;
      operation?: string;
    }
  ): Promise<void> {
    try {
      const result = await this.eventBridge.putEvents({
        Entries: [
          {
            Source: 'postolio.campaign',
            DetailType: 'campaign.content.associated',
            Detail: JSON.stringify({
              campaignId,
              contentId,
              brandId,
              triggeredBy,
              timestamp: new Date().toISOString(),
            }),
            EventBusName: process.env.EVENT_BUS_NAME || 'default',
          },
        ],
      });

      this.logPutEventsResult(
        result,
        'Campaign content association event emitted',
        'Failed to emit campaign content association event',
        { campaignId, contentId, brandId }
      );
    } catch (error) {
      // Log error but don't fail the request - this is non-blocking
      this.logger.error('Error emitting campaign content association event', {
        campaignId,
        contentId,
        brandId,
        ...formatError(error),
      });
    }
  }

  private logPutEventsResult(
    result: PutEventsCommandOutput,
    successMessage: string,
    failureMessage: string,
    context: Record<string, unknown>
  ): void {
    if (result.FailedEntryCount && result.FailedEntryCount > 0) {
      this.logger.error(failureMessage, {
        ...context,
        failedEntryCount: result.FailedEntryCount,
        entries: result.Entries,
      });
    } else {
      this.logger.info(successMessage, context);
    }
  }
}

// Export singleton instance
export const eventEmitter = EventEmitter.getInstance();
