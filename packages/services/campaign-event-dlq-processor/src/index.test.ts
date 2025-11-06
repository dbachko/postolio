import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler, healthCheck } from './index';
import type { SQSEvent } from 'aws-lambda';

// Mock the dependencies
vi.mock('@aws-lambda-powertools/logger', () => ({
  Logger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('@aws-lambda-powertools/tracer', () => ({
  Tracer: vi.fn(() => ({
    captureAWSv3Client: vi.fn((client) => client),
  })),
}));

vi.mock('@aws-lambda-powertools/metrics', () => ({
  Metrics: vi.fn(() => ({
    addMetric: vi.fn(),
    publishStoredMetrics: vi.fn(),
  })),
  MetricUnit: {
    Count: 'Count',
  },
}));

vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridge: vi.fn(() => ({
    send: vi.fn().mockResolvedValue({}),
  })),
  PutEventsCommand: vi.fn(),
}));

vi.mock('@postolio/aws', () => ({
  campaignConsistency: {
    reconcileCampaignState: vi.fn(),
    checkConsistency: vi.fn(),
    healthCheck: vi.fn(),
  },
}));

describe('Campaign Event DLQ Processor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handler', () => {
    it('should process SQS events successfully', async () => {
      const { campaignConsistency } = await import('@postolio/aws');

      // Mock successful reconciliation
      vi.mocked(campaignConsistency.reconcileCampaignState).mockResolvedValue({
        success: true,
        action: 'sync_to_dynamo',
        details: 'Successfully synced to DynamoDB',
      });

      vi.mocked(campaignConsistency.checkConsistency).mockResolvedValue({
        isConsistent: true,
        pgCampaign: {} as Record<string, unknown>,
        dynamoCampaign: {} as Record<string, unknown>,
      });

      const sqsEvent: SQSEvent = {
        Records: [
          {
            messageId: 'test-message-1',
            receiptHandle: 'test-receipt-1',
            body: JSON.stringify({
              'detail-type': 'campaign.status.changed',
              source: 'postolio.campaigns',
              detail: {
                campaignId: 'campaign-123',
                brandId: 'brand-456',
                status: 'active',
                timestamp: new Date().toISOString(),
              },
            }),
            attributes: {
              ApproximateReceiveCount: '1',
              SentTimestamp: '1234567890',
              SenderId: 'test-sender',
              ApproximateFirstReceiveTimestamp: '1234567890',
            },
            messageAttributes: {},
            md5OfBody: 'test-md5',
            eventSource: 'aws:sqs',
            eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
            awsRegion: 'us-east-1',
          },
        ],
      };

      await handler(sqsEvent);

      // Verify reconciliation was attempted
      expect(campaignConsistency.reconcileCampaignState).toHaveBeenCalledWith('campaign-123');
      expect(campaignConsistency.checkConsistency).toHaveBeenCalledWith('campaign-123');
    });

    it('should handle reconciliation failures gracefully', async () => {
      const { campaignConsistency } = await import('@postolio/aws');

      // Mock failed reconciliation
      vi.mocked(campaignConsistency.reconcileCampaignState).mockResolvedValue({
        success: false,
        action: 'manual_review',
        details: 'Manual intervention required',
        error: 'Campaign state conflict',
      });

      const sqsEvent: SQSEvent = {
        Records: [
          {
            messageId: 'test-message-2',
            receiptHandle: 'test-receipt-2',
            body: JSON.stringify({
              'detail-type': 'campaign.status.changed',
              source: 'postolio.campaigns',
              detail: {
                campaignId: 'campaign-789',
                brandId: 'brand-012',
                status: 'paused',
                timestamp: new Date().toISOString(),
              },
            }),
            attributes: {
              ApproximateReceiveCount: '1',
              SentTimestamp: '1234567890',
              SenderId: 'test-sender',
              ApproximateFirstReceiveTimestamp: '1234567890',
            },
            messageAttributes: {},
            md5OfBody: 'test-md5',
            eventSource: 'aws:sqs',
            eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
            awsRegion: 'us-east-1',
          },
        ],
      };

      await handler(sqsEvent);

      // Verify reconciliation was attempted
      expect(campaignConsistency.reconcileCampaignState).toHaveBeenCalledWith('campaign-789');
    });

    it('should handle invalid JSON in SQS message', async () => {
      const sqsEvent: SQSEvent = {
        Records: [
          {
            messageId: 'test-message-3',
            receiptHandle: 'test-receipt-3',
            body: 'invalid json',
            attributes: {
              ApproximateReceiveCount: '1',
              SentTimestamp: '1234567890',
              SenderId: 'test-sender',
              ApproximateFirstReceiveTimestamp: '1234567890',
            },
            messageAttributes: {},
            md5OfBody: 'test-md5',
            eventSource: 'aws:sqs',
            eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
            awsRegion: 'us-east-1',
          },
        ],
      };

      // Should not throw even with invalid JSON
      await expect(handler(sqsEvent)).resolves.not.toThrow();
    });
  });

  describe('healthCheck', () => {
    it('should return healthy when all systems are operational', async () => {
      const { campaignConsistency } = await import('@postolio/aws');

      vi.mocked(campaignConsistency.healthCheck).mockResolvedValue({
        healthy: true,
        details: 'All systems operational',
      });

      const result = await healthCheck();

      expect(result).toEqual({
        healthy: true,
        details: 'Campaign event DLQ processor is healthy',
      });
    });

    it('should return unhealthy when campaign consistency system fails', async () => {
      const { campaignConsistency } = await import('@postolio/aws');

      vi.mocked(campaignConsistency.healthCheck).mockResolvedValue({
        healthy: false,
        details: 'Database connection failed',
      });

      const result = await healthCheck();

      expect(result).toEqual({
        healthy: false,
        details: 'Campaign consistency system unhealthy: Database connection failed',
      });
    });

    it('should handle health check errors', async () => {
      const { campaignConsistency } = await import('@postolio/aws');

      vi.mocked(campaignConsistency.healthCheck).mockRejectedValue(new Error('Network timeout'));

      const result = await healthCheck();

      expect(result).toEqual({
        healthy: false,
        details: 'Health check failed: Network timeout',
      });
    });
  });
});
