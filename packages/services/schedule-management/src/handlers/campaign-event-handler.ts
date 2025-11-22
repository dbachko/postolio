/**
 * Campaign Event Handler
 *
 * Handles EventBridge campaign events for DynamoDB sync
 * Separated from HTTP handlers for better maintainability and debugging
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { CampaignService } from '../services/campaign-service';

const logger = new Logger({ serviceName: 'schedule-management-events' });
const metrics = new Metrics({
  namespace: 'ContentScheduler',
  serviceName: 'schedule-management-events',
});

export interface EventBridgeEvent {
  'detail-type': string;
  source: string;
  detail: {
    campaignId: string;
    brandId: string;
    oldStatus?: string;
    newStatus?: string;
    status?: string;
    triggeredBy?: {
      userId?: string;
      operation?: string;
    };
    timestamp: string;
    // Allow additional properties for testing
    [key: string]: unknown;
  };
}

export class CampaignEventHandler {
  private campaignService: CampaignService;

  constructor() {
    this.campaignService = new CampaignService();
  }

  /**
   * Main EventBridge event handler
   */
  async handle(event: EventBridgeEvent): Promise<void> {
    logger.info('Processing campaign event', {
      source: event.source,
      detailType: event['detail-type'],
      campaignId: event.detail.campaignId,
    });

    try {
      await this.processCampaignEvent(event);

      metrics.addMetric('CampaignEventProcessed', MetricUnit.Count, 1);
      metrics.addMetric(
        `CampaignEvent_${event['detail-type'].replace('.', '_')}`,
        MetricUnit.Count,
        1
      );

      logger.info('Campaign event processed successfully', {
        campaignId: event.detail.campaignId,
        eventType: event['detail-type'],
      });
    } catch (error) {
      logger.error('Failed to process campaign event', {
        error,
        campaignId: event.detail.campaignId,
        eventType: event['detail-type'],
      });

      metrics.addMetric('CampaignEventFailed', MetricUnit.Count, 1);

      // Re-throw to trigger DLQ processing
      throw error;
    } finally {
      this.flushMetrics();
    }
  }

  /**
   * Process different types of campaign events
   */
  private async processCampaignEvent(event: EventBridgeEvent): Promise<void> {
    const { campaignId } = event.detail;

    switch (event['detail-type']) {
      case 'campaign.created':
        await this.handleCampaignCreated(event);
        break;

      case 'campaign.status.changed':
        await this.handleCampaignStatusChanged(event);
        break;

      default:
        logger.warn('Unknown campaign event type', {
          detailType: event['detail-type'],
          campaignId,
        });
      // Don't throw error for unknown events - just log and continue
    }
  }

  /**
   * Handle campaign created events
   */
  private async handleCampaignCreated(event: EventBridgeEvent): Promise<void> {
    const { campaignId, brandId, status } = event.detail;

    logger.info('Handling campaign created event', {
      campaignId,
      brandId,
      status,
    });

    // Validate and cast status to ensure it's a valid campaign status
    const validStatuses: readonly string[] = ['active', 'paused', 'completed', 'failed'];
    const campaignStatus =
      status && validStatuses.includes(status)
        ? (status as 'active' | 'paused' | 'completed' | 'failed')
        : 'active';

    try {
      const result = await this.campaignService.createCampaignRecord({
        campaignId,
        brandId,
        status: campaignStatus,
      });

      if (!result.success) {
        throw new Error(`Failed to create campaign record: ${result.error}`);
      }

      logger.info('Campaign record created in DynamoDB', {
        campaignId,
        brandId,
        status: status || 'active',
      });

      metrics.addMetric('CampaignRecordCreated', MetricUnit.Count, 1);
    } catch (error) {
      logger.error('Failed to handle campaign created event', {
        error,
        campaignId,
        brandId,
      });
      throw error; // Re-throw to trigger DLQ
    }
  }

  /**
   * Handle campaign status change events
   */
  private async handleCampaignStatusChanged(event: EventBridgeEvent): Promise<void> {
    const { campaignId, brandId, oldStatus, newStatus } = event.detail;

    logger.info('Handling campaign status changed event', {
      campaignId,
      brandId,
      oldStatus,
      newStatus,
    });

    if (!newStatus) {
      throw new Error('Campaign status change event missing newStatus');
    }

    // Validate that newStatus is a valid campaign status
    const validStatuses: readonly string[] = ['active', 'paused', 'completed', 'failed'];
    if (!validStatuses.includes(newStatus)) {
      throw new Error(
        `Invalid campaign status: ${newStatus}. Must be one of: ${validStatuses.join(', ')}`
      );
    }

    try {
      const result = await this.campaignService.updateCampaignStatus({
        campaignId,
        status: newStatus as 'active' | 'paused' | 'completed' | 'failed',
      });

      if (!result.success) {
        throw new Error(`Failed to update campaign status: ${result.error}`);
      }

      logger.info('Campaign status updated in DynamoDB', {
        campaignId,
        oldStatus,
        newStatus,
      });

      metrics.addMetric('CampaignStatusUpdated', MetricUnit.Count, 1);

      // Emit additional metrics for monitoring campaign state transitions
      if (oldStatus && newStatus) {
        metrics.addMetric(`CampaignTransition_${oldStatus}_to_${newStatus}`, MetricUnit.Count, 1);
      }
    } catch (error) {
      logger.error('Failed to handle campaign status changed event', {
        error,
        campaignId,
        oldStatus,
        newStatus,
      });
      throw error; // Re-throw to trigger DLQ
    }
  }

  /**
   * Validate event structure
   */
  private validateEventStructure(event: EventBridgeEvent): boolean {
    try {
      // Check required fields
      if (!event.source || !event['detail-type'] || !event.detail) {
        logger.error('Invalid event structure - missing required fields', { event });
        return false;
      }

      if (!event.detail.campaignId || !event.detail.brandId) {
        logger.error('Invalid event detail - missing campaignId or brandId', {
          detail: event.detail,
        });
        return false;
      }

      // Validate event source
      if (event.source !== 'postolio.campaign') {
        logger.error('Invalid event source', {
          source: event.source,
          expected: 'postolio.campaign',
        });
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Error validating event structure', { error, event });
      return false;
    }
  }

  /**
   * Health check for event processing system
   */
  async healthCheck(): Promise<{ healthy: boolean; details: string }> {
    try {
      // Test DynamoDB connectivity through campaign service
      const healthStatus = await this.campaignService.healthCheck();

      if (!healthStatus.healthy) {
        return {
          healthy: false,
          details: `Campaign service unhealthy: ${healthStatus.details}`,
        };
      }

      return {
        healthy: true,
        details: 'Campaign event processing system is healthy',
      };
    } catch (error) {
      logger.error('Campaign event handler health check failed', { error });
      return {
        healthy: false,
        details: `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Publish metrics only when present to avoid Powertools warnings
   */
  private flushMetrics(): void {
    if (metrics.hasStoredMetrics()) {
      metrics.publishStoredMetrics();
    } else {
      metrics.clearMetrics();
      metrics.clearDimensions();
      metrics.clearMetadata();
    }
  }
}

// Export singleton instance
export const campaignEventHandler = new CampaignEventHandler();
