/**
 * EventBridge Event Emitter Service
 * Emits events to AWS EventBridge for microservices communication
 */

import { EventBridge } from '@aws-sdk/client-eventbridge';

export class EventEmitter {
  private eventBridge: EventBridge;
  private static instance: EventEmitter | null = null;

  constructor() {
    // Initialize EventBridge client
    // Will use default credentials from environment or IAM role
    this.eventBridge = new EventBridge({
      region: process.env.AWS_REGION || 'us-east-1',
    });
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
          },
        ],
      });

      if (result.FailedEntryCount && result.FailedEntryCount > 0) {
        console.error('Failed to emit content updated event:', result.Entries);
      } else {
        console.log(`Content updated event emitted for content ${contentId}`);
      }
    } catch (error) {
      // Log error but don't fail the request
      console.error('Error emitting content updated event:', error);
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
          },
        ],
      });

      if (result.FailedEntryCount && result.FailedEntryCount > 0) {
        console.error('Failed to emit content published event:', result.Entries);
      } else {
        console.log(`Content published event emitted for content ${contentId}`);
      }
    } catch (error) {
      console.error('Error emitting content published event:', error);
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
          },
        ],
      });

      if (result.FailedEntryCount && result.FailedEntryCount > 0) {
        console.error('Failed to emit content scheduled event:', result.Entries);
      } else {
        console.log(`Content scheduled event emitted for content ${contentId}`);
      }
    } catch (error) {
      console.error('Error emitting content scheduled event:', error);
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
          },
        ],
      });

      if (result.FailedEntryCount && result.FailedEntryCount > 0) {
        console.error('Failed to emit content scheduling failed event:', result.Entries);
      }
    } catch (error) {
      console.error('Error emitting content scheduling failed event:', error);
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
          },
        ],
      });

      if (result.FailedEntryCount && result.FailedEntryCount > 0) {
        console.error('Failed to emit campaign status changed event:', result.Entries);
      } else {
        console.log(
          `🔔 Campaign status event emitted: ${campaignId} (${oldStatus} → ${newStatus})`
        );
      }
    } catch (error) {
      // Log error but don't fail the request - this is non-blocking
      console.error('Error emitting campaign status changed event:', error);
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
          },
        ],
      });

      if (result.FailedEntryCount && result.FailedEntryCount > 0) {
        console.error('Failed to emit campaign created event:', result.Entries);
      } else {
        console.log(`🔔 Campaign created event emitted: ${campaignId} (status: ${status})`);
      }
    } catch (error) {
      // Log error but don't fail the request - this is non-blocking
      console.error('Error emitting campaign created event:', error);
    }
  }
}

// Export singleton instance
export const eventEmitter = EventEmitter.getInstance();
