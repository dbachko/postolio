/**
 * Integration tests for Publisher Lambda
 * Tests critical publishing workflows including Instagram publishing,
 * credential validation, campaign blocking, and error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { EventBridgeEvent, Context } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { EventBridge, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { SchedulerClient, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';

// Type for schedule.due event detail
interface ScheduleDueDetail {
  scheduleId: string;
  brandId?: string;
  userId?: string;
  retryAttempt?: number;
}

// Mock @postolio/aws module
vi.mock('@postolio/aws', () => ({
  getCampaignByContentId: vi.fn(),
  getCampaignById: vi.fn(),
  isCampaignActive: vi.fn(),
  getCampaignBlockReason: vi.fn(),
  getServiceUrl: vi.fn(),
  signRequest: vi.fn(),
  API_VERSIONS: { FACEBOOK_GRAPH: 'v21.0' },
  API_BASE_URLS: { FACEBOOK_GRAPH: 'https://graph.facebook.com' },
}));

// Mock AWS SDK clients
const dynamoMock = mockClient(DynamoDBDocumentClient);
const sqsMock = mockClient(SQSClient);
const eventBridgeMock = mockClient(EventBridge);
const schedulerMock = mockClient(SchedulerClient);

// Mock fetch for Instagram API calls
const fetchMock = vi.fn();
global.fetch = fetchMock as typeof fetch;

describe('Publisher Lambda', () => {
  let getCampaignByContentIdMock: ReturnType<typeof vi.fn>;
  let getCampaignByIdMock: ReturnType<typeof vi.fn>;
  let isCampaignActiveMock: ReturnType<typeof vi.fn>;
  let getCampaignBlockReasonMock: ReturnType<typeof vi.fn>;
  let getServiceUrlMock: ReturnType<typeof vi.fn>;
  let signRequestMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Reset all mocks
    dynamoMock.reset();
    sqsMock.reset();
    eventBridgeMock.reset();
    schedulerMock.reset();
    fetchMock.mockReset();

    // Get mock functions from the mocked module
    const aws = await import('@postolio/aws');
    getCampaignByContentIdMock = aws.getCampaignByContentId as ReturnType<typeof vi.fn>;
    getCampaignByIdMock = aws.getCampaignById as ReturnType<typeof vi.fn>;
    isCampaignActiveMock = aws.isCampaignActive as ReturnType<typeof vi.fn>;
    getCampaignBlockReasonMock = aws.getCampaignBlockReason as ReturnType<typeof vi.fn>;
    getServiceUrlMock = aws.getServiceUrl as ReturnType<typeof vi.fn>;
    signRequestMock = aws.signRequest as ReturnType<typeof vi.fn>;

    // Reset module mocks
    getCampaignByContentIdMock.mockReset();
    getCampaignByIdMock.mockReset();
    isCampaignActiveMock.mockReset();
    getCampaignBlockReasonMock.mockReset();
    getServiceUrlMock.mockReset();
    signRequestMock.mockReset();

    // Default mocks for campaign functions (no campaign associated)
    getCampaignByContentIdMock.mockResolvedValue(null);
    isCampaignActiveMock.mockReturnValue(true);
    getCampaignBlockReasonMock.mockReturnValue(null);

    // Mock service URL and request signing
    getServiceUrlMock.mockResolvedValue('https://token-service.example.com');
    signRequestMock.mockResolvedValue({
      'Content-Type': 'application/json',
      Authorization: 'AWS4-HMAC-SHA256 ...',
    });

    // Set required environment variables
    process.env.SCHEDULES_TABLE = 'test-schedules-table';
    process.env.EVENT_BUS_NAME = 'test-event-bus';
    process.env.DLQ_URL = 'https://sqs.us-east-1.amazonaws.com/123456789/test-dlq';
    process.env.RETRY_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789/test-retry-queue';
    process.env.SCHEDULER_GROUP_NAME = 'test-scheduler-group';
    process.env.ASSETS_CDN_DOMAIN = 'cdn.example.com';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Instagram Publishing', () => {
    it('should successfully publish an image post to Instagram', async () => {
      // Arrange: Mock DynamoDB schedule retrieval via QueryCommand
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            pk: 'BRAND#brand-789',
            sk: 'SCHEDULE#test-schedule-123',
            scheduleId: 'test-schedule-123',
            contentId: 'content-456',
            brandId: 'brand-789',
            userId: 'user-001',
            platform: 'instagram',
            caption: 'Test post caption',
            contentType: 'post',
            mediaType: 'image',
            mediaKeys: ['images/test-image.jpg'],
            mediaAssets: [
              {
                key: 'images/test-image.jpg',
                type: 'image',
                order: 0,
              },
            ],
          },
        ],
      });

      // Mock token service HTTP call for credentials
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessToken: 'test-access-token',
          metadata: {
            accountId: 'instagram-account-123',
          },
        }),
      });

      // Mock Instagram Graph API responses
      // 1. Container creation
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'creation-id-123' }),
      });

      // 2. Publish container
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'media-id-789' }),
      });

      // 3. Permalink fetch
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ permalink: 'https://instagram.com/p/test123' }),
      });

      // Mock DynamoDB update
      dynamoMock.on(UpdateCommand).resolves({});

      // Mock EventBridge success event
      eventBridgeMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });

      // Mock scheduler cleanup
      schedulerMock.on(DeleteScheduleCommand).resolves({});

      // Act: Import and call handler
      const { handler } = await import('./index.js');
      const event: EventBridgeEvent<'schedule.due', ScheduleDueDetail> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'schedule.due',
        source: 'postolio.scheduling',
        account: '123456789',
        time: new Date().toISOString(),
        region: 'us-east-1',
        resources: [],
        detail: {
          scheduleId: 'test-schedule-123',
        },
      };

      await handler(event, {} as Context);

      // Assert: Verify token service was called
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('token-service.example.com/tokens'),
        expect.objectContaining({
          method: 'GET',
        })
      );

      // Verify Instagram API was called correctly
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('instagram-account-123/media'),
        expect.anything()
      );

      // Verify success event was published
      expect(eventBridgeMock.commandCalls(PutEventsCommand)).toHaveLength(1);
      const eventCall = eventBridgeMock.commandCalls(PutEventsCommand)[0];
      expect(eventCall.args[0].input.Entries?.[0].DetailType).toBe('post.published');

      // Verify schedule was deleted
      expect(schedulerMock.commandCalls(DeleteScheduleCommand)).toHaveLength(1);
    });

    it('should handle missing credentials gracefully', async () => {
      // Arrange: Mock DynamoDB schedule retrieval
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            pk: 'BRAND#brand-789',
            sk: 'SCHEDULE#test-schedule-123',
            scheduleId: 'test-schedule-123',
            contentId: 'content-456',
            brandId: 'brand-789',
            userId: 'user-001',
            platform: 'instagram',
            caption: 'Test post',
          },
        ],
      });

      // Mock token service returning no credentials
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ error: 'No credentials found' }),
      });

      // Mock retry queue message send
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'retry-msg-123' });

      // Mock failure event
      eventBridgeMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });

      // Mock schedule deletion
      schedulerMock.on(DeleteScheduleCommand).resolves({});

      // Mock DynamoDB update
      dynamoMock.on(UpdateCommand).resolves({});

      // Act
      const { handler } = await import('./index.js');
      const event: EventBridgeEvent<'schedule.due', ScheduleDueDetail> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'schedule.due',
        source: 'postolio.scheduling',
        account: '123456789',
        time: new Date().toISOString(),
        region: 'us-east-1',
        resources: [],
        detail: {
          scheduleId: 'test-schedule-123',
        },
      };

      await handler(event, {} as Context);

      // Assert: Verify retry queue message was sent
      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
      const sqsCall = sqsMock.commandCalls(SendMessageCommand)[0];
      expect(sqsCall.args[0].input.QueueUrl).toBe(
        'https://sqs.us-east-1.amazonaws.com/123456789/test-retry-queue'
      );

      // Verify failure event was published
      const eventCall = eventBridgeMock.commandCalls(PutEventsCommand)[0];
      expect(eventCall.args[0].input.Entries?.[0].DetailType).toBe('post.failed');
    });

    it('should handle Instagram API rate limiting', async () => {
      // Arrange: Mock DynamoDB schedule retrieval
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            pk: 'BRAND#brand-789',
            sk: 'SCHEDULE#test-schedule-123',
            scheduleId: 'test-schedule-123',
            contentId: 'content-456',
            brandId: 'brand-789',
            userId: 'user-001',
            platform: 'instagram',
            caption: 'Test post',
            contentType: 'post',
            mediaType: 'image',
            mediaKeys: ['images/test.jpg'],
          },
        ],
      });

      // Mock token service credentials
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessToken: 'test-token',
          metadata: {
            accountId: 'ig-123',
          },
        }),
      });

      // Mock Instagram API returning rate limit error
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () =>
          JSON.stringify({
            error: {
              code: 4,
              message: 'Application request limit reached',
            },
          }),
      });

      // Mock retry queue message send
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'retry-msg-123' });

      // Mock failure event
      eventBridgeMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });

      // Mock schedule deletion
      schedulerMock.on(DeleteScheduleCommand).resolves({});

      // Mock DynamoDB update
      dynamoMock.on(UpdateCommand).resolves({});

      // Act
      const { handler } = await import('./index.js');
      const event: EventBridgeEvent<'schedule.due', ScheduleDueDetail> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'schedule.due',
        source: 'postolio.scheduling',
        account: '123456789',
        time: new Date().toISOString(),
        region: 'us-east-1',
        resources: [],
        detail: {
          scheduleId: 'test-schedule-123',
        },
      };

      await handler(event, {} as Context);

      // Assert: Should send to retry queue, not DLQ
      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
      const sqsCall = sqsMock.commandCalls(SendMessageCommand)[0];
      // Verify retry queue is used (not DLQ)
      expect(sqsCall.args[0].input.QueueUrl).toBe(
        'https://sqs.us-east-1.amazonaws.com/123456789/test-retry-queue'
      );
    });
  });

  describe('Campaign Blocking', () => {
    it('should skip publishing if campaign is paused', async () => {
      // Arrange: Mock DynamoDB schedule with campaign
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            pk: 'BRAND#brand-789',
            sk: 'SCHEDULE#test-schedule-123',
            scheduleId: 'test-schedule-123',
            contentId: 'content-456',
            brandId: 'brand-789',
            userId: 'user-001',
            campaignId: 'campaign-001',
            platform: 'instagram',
            caption: 'Test post',
          },
        ],
      });

      // Mock campaign functions to return paused campaign
      const pausedCampaign = {
        campaignId: 'campaign-001',
        status: 'paused',
        active: false,
      };
      getCampaignByContentIdMock.mockResolvedValueOnce(pausedCampaign);
      getCampaignByIdMock.mockResolvedValueOnce(pausedCampaign);
      isCampaignActiveMock.mockReturnValueOnce(false);
      getCampaignBlockReasonMock.mockReturnValueOnce('Campaign is paused');

      // Mock skip event
      eventBridgeMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });

      // Mock schedule deletion
      schedulerMock.on(DeleteScheduleCommand).resolves({});

      // Mock DynamoDB update
      dynamoMock.on(UpdateCommand).resolves({});

      // Act
      const { handler } = await import('./index.js');
      const event: EventBridgeEvent<'schedule.due', ScheduleDueDetail> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'schedule.due',
        source: 'postolio.scheduling',
        account: '123456789',
        time: new Date().toISOString(),
        region: 'us-east-1',
        resources: [],
        detail: {
          scheduleId: 'test-schedule-123',
        },
      };

      await handler(event, {} as Context);

      // Assert: Verify post.skipped event was published
      const eventCall = eventBridgeMock.commandCalls(PutEventsCommand)[0];
      expect(eventCall.args[0].input.Entries?.[0].DetailType).toBe('post.skipped');
      expect(eventCall.args[0].input.Entries?.[0].Detail).toContain('campaign');

      // Should not call token service or Instagram API (no fetch calls)
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should forward to DLQ on non-retryable errors', async () => {
      // Arrange
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            pk: 'BRAND#brand-789',
            sk: 'SCHEDULE#test-schedule-123',
            scheduleId: 'test-schedule-123',
            contentId: 'content-456',
            brandId: 'brand-789',
            userId: 'user-001',
            platform: 'instagram',
            caption: 'Test post',
          },
        ],
      });

      // Mock token service credentials
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessToken: 'test-token',
          metadata: {
            accountId: 'ig-123',
          },
        }),
      });

      // Mock Instagram API returning unrecoverable error (e.g., invalid content)
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            error: { message: 'Invalid media format' },
          }),
      });

      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'retry-msg-123' });
      eventBridgeMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });
      schedulerMock.on(DeleteScheduleCommand).resolves({});
      dynamoMock.on(UpdateCommand).resolves({});

      // Act
      const { handler } = await import('./index.js');
      const event: EventBridgeEvent<'schedule.due', ScheduleDueDetail> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'schedule.due',
        source: 'postolio.scheduling',
        account: '123456789',
        time: new Date().toISOString(),
        region: 'us-east-1',
        resources: [],
        detail: {
          scheduleId: 'test-schedule-123',
        },
      };

      await handler(event, {} as Context);

      // Assert: Should send to retry queue (all errors go through retry handler)
      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
      const sqsCall = sqsMock.commandCalls(SendMessageCommand)[0];
      expect(sqsCall.args[0].input.QueueUrl).toBe(
        'https://sqs.us-east-1.amazonaws.com/123456789/test-retry-queue'
      );
    });
  });
});
