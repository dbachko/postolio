/**
 * Campaign Event DLQ Processor
 *
 * Processes failed campaign events from the Dead Letter Queue
 * and attempts to reconcile campaign state inconsistencies.
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { SQSEvent, SQSRecord } from 'aws-lambda';
import { EventBridge, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { campaignConsistency } from '@postolio/aws';

// Initialize Powertools
const logger = new Logger({ serviceName: 'campaign-event-dlq-processor' });
const tracer = new Tracer({ serviceName: 'campaign-event-dlq-processor' });
const metrics = new Metrics({
  namespace: 'ContentScheduler',
  serviceName: 'campaign-event-dlq-processor',
});

// Initialize AWS SDK clients
const eventBridge = tracer.captureAWSv3Client(new EventBridge({}));

interface CampaignEventDetail {
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
}

interface FailedCampaignEvent {
  'detail-type': string;
  source: string;
  detail: CampaignEventDetail;
  originalAttempts?: number;
  dlqTimestamp?: string;
}

export const handler = async (event: SQSEvent): Promise<void> => {
  logger.info('Processing campaign event DLQ messages', {
    messageCount: event.Records.length,
  });

  const results = await Promise.allSettled(
    event.Records.map((record) => processFailedCampaignEvent(record))
  );

  // Count successes and failures
  const successful = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;

  logger.info('Campaign event DLQ processing completed', {
    total: event.Records.length,
    successful,
    failed,
  });

  metrics.addMetric('CampaignEventDLQProcessed', MetricUnit.Count, successful);
  metrics.addMetric('CampaignEventDLQFailed', MetricUnit.Count, failed);
  metrics.publishStoredMetrics();

  // Log any failures
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger.error('Failed to process DLQ message', {
        messageIndex: index,
        error: result.reason,
        messageId: event.Records[index].messageId,
      });
    }
  });
};

async function processFailedCampaignEvent(record: SQSRecord): Promise<void> {
  logger.info('Processing failed campaign event', {
    messageId: record.messageId,
    receiptHandle: record.receiptHandle,
  });

  try {
    // Parse the failed event from the DLQ message
    const failedEvent = JSON.parse(record.body) as FailedCampaignEvent;
    const { campaignId, brandId } = failedEvent.detail;

    logger.info('Attempting to reconcile campaign state for failed event', {
      campaignId,
      brandId,
      eventType: failedEvent['detail-type'],
      originalTimestamp: failedEvent.detail.timestamp,
    });

    // Attempt to reconcile campaign state
    const reconciliationResult = await campaignConsistency.reconcileCampaignState(campaignId);

    if (reconciliationResult.success) {
      logger.info('Successfully reconciled campaign state from DLQ', {
        campaignId,
        action: reconciliationResult.action,
        details: reconciliationResult.details,
      });

      // If we successfully reconciled, we can consider this event processed
      metrics.addMetric('CampaignEventDLQReconciled', MetricUnit.Count, 1);

      // Emit a reconciliation success event
      await emitReconciliationEvent(campaignId, failedEvent, reconciliationResult);
    } else {
      logger.error('Failed to reconcile campaign state from DLQ', {
        campaignId,
        error: reconciliationResult.error,
        details: reconciliationResult.details,
      });

      // If reconciliation failed, we need manual intervention
      await emitManualInterventionEvent(campaignId, failedEvent, reconciliationResult);

      metrics.addMetric('CampaignEventDLQManualReview', MetricUnit.Count, 1);

      // Don't throw error - we want to acknowledge the message to prevent infinite retries
      // Manual intervention events will alert operations team
    }

    // Perform a final consistency check to verify state
    const consistencyCheck = await campaignConsistency.checkConsistency(campaignId);
    if (!consistencyCheck.isConsistent) {
      logger.warn('Campaign state still inconsistent after DLQ processing', {
        campaignId,
        conflict: consistencyCheck.conflict,
      });

      metrics.addMetric('CampaignEventDLQStillInconsistent', MetricUnit.Count, 1);
    }
  } catch (error) {
    logger.error('Error processing failed campaign event', {
      error,
      messageId: record.messageId,
    });

    metrics.addMetric('CampaignEventDLQProcessingError', MetricUnit.Count, 1);
    throw error; // Re-throw to trigger SQS retry
  }
}

async function emitReconciliationEvent(
  campaignId: string,
  originalEvent: FailedCampaignEvent,
  reconciliationResult: {
    action: string;
    details: string;
    error?: string;
  }
): Promise<void> {
  try {
    await eventBridge.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'postolio.dlq-processor',
            DetailType: 'campaign.dlq.reconciled',
            Detail: JSON.stringify({
              campaignId,
              originalEvent: {
                type: originalEvent['detail-type'],
                timestamp: originalEvent.detail.timestamp,
                source: originalEvent.source,
              },
              reconciliation: {
                action: reconciliationResult.action,
                details: reconciliationResult.details,
                reconciledAt: new Date().toISOString(),
              },
              severity: 'info',
            }),
          },
        ],
      })
    );

    logger.info('Emitted DLQ reconciliation success event', { campaignId });
  } catch (error) {
    logger.warn('Failed to emit DLQ reconciliation event', { error, campaignId });
    // Don't fail the operation if event emission fails
  }
}

async function emitManualInterventionEvent(
  campaignId: string,
  originalEvent: FailedCampaignEvent,
  reconciliationResult: {
    action: string;
    details: string;
    error?: string;
  }
): Promise<void> {
  try {
    await eventBridge.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'postolio.dlq-processor',
            DetailType: 'campaign.dlq.manual-intervention-required',
            Detail: JSON.stringify({
              campaignId,
              brandId: originalEvent.detail.brandId,
              originalEvent: {
                type: originalEvent['detail-type'],
                timestamp: originalEvent.detail.timestamp,
                source: originalEvent.source,
                detail: originalEvent.detail,
              },
              reconciliation: {
                action: reconciliationResult.action,
                details: reconciliationResult.details,
                error: reconciliationResult.error,
                attemptedAt: new Date().toISOString(),
              },
              severity: 'high',
              requiresManualReview: true,
              alertOpsTeam: true,
            }),
          },
        ],
      })
    );

    logger.info('Emitted manual intervention required event', { campaignId });
  } catch (error) {
    logger.warn('Failed to emit manual intervention event', { error, campaignId });
    // Don't fail the operation if event emission fails
  }
}

/**
 * Health check function for monitoring
 */
export const healthCheck = async (): Promise<{ healthy: boolean; details: string }> => {
  try {
    // Test campaign consistency system
    const healthResult = await campaignConsistency.healthCheck();

    if (!healthResult.healthy) {
      return {
        healthy: false,
        details: `Campaign consistency system unhealthy: ${healthResult.details}`,
      };
    }

    return {
      healthy: true,
      details: 'Campaign event DLQ processor is healthy',
    };
  } catch (error) {
    logger.error('Health check failed', { error });
    return {
      healthy: false,
      details: `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
};