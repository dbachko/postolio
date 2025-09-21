import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScheduleService } from './schedule-service';
import { ServiceError } from '@postolio/errors';

// Mock AWS SDK clients
const mockDynamoSend = vi.fn();
const mockEventBridgeSend = vi.fn();
const mockSchedulerSend = vi.fn();

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({
      send: mockDynamoSend,
    })),
  },
  GetCommand: vi.fn((params) => ({ name: 'GetCommand', params })),
  PutCommand: vi.fn((params) => ({ name: 'PutCommand', params })),
  UpdateCommand: vi.fn((params) => ({ name: 'UpdateCommand', params })),
  DeleteCommand: vi.fn((params) => ({ name: 'DeleteCommand', params })),
  QueryCommand: vi.fn((params) => ({ name: 'QueryCommand', params })),
}));

vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: vi.fn(() => ({
    send: mockEventBridgeSend,
  })),
  PutEventsCommand: vi.fn((params) => ({ name: 'PutEventsCommand', params })),
}));

vi.mock('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: vi.fn(() => ({
    send: mockSchedulerSend,
  })),
  CreateScheduleCommand: vi.fn((params) => ({ name: 'CreateScheduleCommand', params })),
  UpdateScheduleCommand: vi.fn((params) => ({ name: 'UpdateScheduleCommand', params })),
  DeleteScheduleCommand: vi.fn((params) => ({ name: 'DeleteScheduleCommand', params })),
}));

// Mock AWS utilities
vi.mock('@postolio/aws', () => ({
  getCampaignById: vi.fn(),
  isCampaignActive: vi.fn(),
  createServiceLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    operationStart: vi.fn(),
    operationSuccess: vi.fn(),
    operationFailure: vi.fn(),
  })),
}));

describe('ScheduleService', () => {
  let scheduleService: ScheduleService;

  beforeEach(() => {
    vi.clearAllMocks();
    scheduleService = new ScheduleService();

    // Set up environment variables
    process.env.SCHEDULES_TABLE = 'test-schedules-table';
    process.env.SCHEDULE_GROUP_NAME = 'test-schedule-group';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createSchedule', () => {
    const validRequest = {
      contentId: 'content-123',
      campaignId: 'campaign-456',
      brandId: 'brand-789',
      userId: 'user-012',
      platform: 'instagram' as const,
      scheduledAt: new Date(Date.now() + 3600000).toISOString(),
      caption: 'Test content',
      hashtags: ['test'],
      mediaUrls: ['https://example.com/image.jpg'],
    };

    it('should successfully create a schedule with valid campaign', async () => {
      // Mock campaign validation
      const { getCampaignById, isCampaignActive } = await import('@postolio/aws');
      vi.mocked(getCampaignById).mockResolvedValue({
        campaignId: 'campaign-456',
        status: 'active',
        brandId: 'brand-789',
      });
      vi.mocked(isCampaignActive).mockReturnValue(true);

      // Mock DynamoDB responses
      mockDynamoSend.mockResolvedValueOnce({ Item: null }); // GetCommand - schedule doesn't exist
      mockDynamoSend.mockResolvedValueOnce({}); // PutCommand - create schedule

      // Mock EventBridge response
      mockEventBridgeSend.mockResolvedValueOnce({});

      // Mock Scheduler response
      mockSchedulerSend.mockResolvedValueOnce({});

      const result = await scheduleService.createSchedule(validRequest);

      expect(result.success).toBe(true);
      expect(result.scheduleId).toBeDefined();
      expect(result.message).toContain('created successfully');

      // Verify campaign validation was called
      expect(getCampaignById).toHaveBeenCalledWith('campaign-456');
      expect(isCampaignActive).toHaveBeenCalled();

      // Verify DynamoDB was called to create schedule
      expect(mockDynamoSend).toHaveBeenCalledTimes(2);

      // Verify EventBridge schedule was created
      expect(mockSchedulerSend).toHaveBeenCalledTimes(1);

      // Verify EventBridge event was emitted
      expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);
    });

    it('should reject schedule creation for inactive campaign', async () => {
      // Mock campaign validation
      const { getCampaignById, isCampaignActive } = await import('@postolio/aws');
      vi.mocked(getCampaignById).mockResolvedValue({
        campaignId: 'campaign-456',
        status: 'paused',
        brandId: 'brand-789',
      });
      vi.mocked(isCampaignActive).mockReturnValue(false);

      await expect(scheduleService.createSchedule(validRequest))
        .rejects.toThrow(ServiceError);

      // Should not create any AWS resources
      expect(mockDynamoSend).not.toHaveBeenCalled();
      expect(mockSchedulerSend).not.toHaveBeenCalled();
      expect(mockEventBridgeSend).not.toHaveBeenCalled();
    });

    it('should reject schedule creation for non-existent campaign', async () => {
      // Mock campaign validation
      const { getCampaignById } = await import('@postolio/aws');
      vi.mocked(getCampaignById).mockResolvedValue(null);

      await expect(scheduleService.createSchedule(validRequest))
        .rejects.toThrow(ServiceError);

      // Should not create any AWS resources
      expect(mockDynamoSend).not.toHaveBeenCalled();
      expect(mockSchedulerSend).not.toHaveBeenCalled();
      expect(mockEventBridgeSend).not.toHaveBeenCalled();
    });

    it('should reject duplicate schedule creation', async () => {
      // Mock campaign validation
      const { getCampaignById, isCampaignActive } = await import('@postolio/aws');
      vi.mocked(getCampaignById).mockResolvedValue({
        campaignId: 'campaign-456',
        status: 'active',
        brandId: 'brand-789',
      });
      vi.mocked(isCampaignActive).mockReturnValue(true);

      // Mock existing schedule
      mockDynamoSend.mockResolvedValueOnce({
        Item: {
          pk: 'SCHEDULE#existing-id',
          sk: 'METADATA',
          contentId: 'content-123',
          status: 'pending',
        }
      });

      await expect(scheduleService.createSchedule(validRequest))
        .rejects.toThrow(ServiceError);

      // Should only call GetCommand, not create anything
      expect(mockDynamoSend).toHaveBeenCalledTimes(1);
      expect(mockSchedulerSend).not.toHaveBeenCalled();
    });

    it('should handle EventBridge Scheduler failures gracefully', async () => {
      // Mock campaign validation
      const { getCampaignById, isCampaignActive } = await import('@postolio/aws');
      vi.mocked(getCampaignById).mockResolvedValue({
        campaignId: 'campaign-456',
        status: 'active',
        brandId: 'brand-789',
      });
      vi.mocked(isCampaignActive).mockReturnValue(true);

      // Mock DynamoDB responses
      mockDynamoSend.mockResolvedValueOnce({ Item: null }); // GetCommand
      mockDynamoSend.mockResolvedValueOnce({}); // PutCommand
      mockDynamoSend.mockResolvedValueOnce({}); // UpdateCommand (for failure)

      // Mock EventBridge response
      mockEventBridgeSend.mockResolvedValueOnce({});

      // Mock Scheduler failure
      mockSchedulerSend.mockRejectedValueOnce(new Error('Scheduler service unavailable'));

      await expect(scheduleService.createSchedule(validRequest))
        .rejects.toThrow('Scheduler service unavailable');

      // Should have updated schedule status to failed
      expect(mockDynamoSend).toHaveBeenCalledTimes(3);
    });
  });

  describe('getSchedule', () => {
    it('should retrieve existing schedule', async () => {
      const mockSchedule = {
        pk: 'SCHEDULE#test-123',
        sk: 'METADATA',
        scheduleId: 'test-123',
        contentId: 'content-123',
        status: 'pending',
        scheduledAt: new Date().toISOString(),
      };

      mockDynamoSend.mockResolvedValueOnce({ Item: mockSchedule });

      const result = await scheduleService.getSchedule('test-123');

      expect(result).toEqual(mockSchedule);
      expect(mockDynamoSend).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'GetCommand',
          params: expect.objectContaining({
            TableName: 'test-schedules-table',
            Key: {
              pk: 'SCHEDULE#test-123',
              sk: 'METADATA',
            },
          }),
        })
      );
    });

    it('should return null for non-existent schedule', async () => {
      mockDynamoSend.mockResolvedValueOnce({ Item: undefined });

      const result = await scheduleService.getSchedule('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('updateSchedule', () => {
    const updateRequest = {
      scheduleId: 'test-123',
      updates: {
        caption: 'Updated caption',
        scheduledAt: new Date(Date.now() + 7200000).toISOString(),
      },
    };

    it('should successfully update existing schedule', async () => {
      const existingSchedule = {
        pk: 'SCHEDULE#test-123',
        sk: 'METADATA',
        scheduleId: 'test-123',
        status: 'pending',
        campaignId: 'campaign-456',
      };

      // Mock campaign validation
      const { getCampaignById, isCampaignActive } = await import('@postolio/aws');
      vi.mocked(getCampaignById).mockResolvedValue({
        campaignId: 'campaign-456',
        status: 'active',
        brandId: 'brand-789',
      });
      vi.mocked(isCampaignActive).mockReturnValue(true);

      mockDynamoSend.mockResolvedValueOnce({ Item: existingSchedule }); // GetCommand
      mockDynamoSend.mockResolvedValueOnce({}); // UpdateCommand
      mockSchedulerSend.mockResolvedValueOnce({}); // UpdateScheduleCommand
      mockEventBridgeSend.mockResolvedValueOnce({}); // PutEventsCommand

      const result = await scheduleService.updateSchedule(updateRequest);

      expect(result.success).toBe(true);
      expect(result.message).toContain('updated successfully');

      // Verify DynamoDB update was called
      expect(mockDynamoSend).toHaveBeenCalledTimes(2);

      // Verify EventBridge schedule was updated if scheduledAt changed
      expect(mockSchedulerSend).toHaveBeenCalledTimes(1);

      // Verify event was emitted
      expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);
    });

    it('should reject update for non-existent schedule', async () => {
      mockDynamoSend.mockResolvedValueOnce({ Item: undefined });

      await expect(scheduleService.updateSchedule(updateRequest))
        .rejects.toThrow(ServiceError);

      // Should only call GetCommand
      expect(mockDynamoSend).toHaveBeenCalledTimes(1);
      expect(mockSchedulerSend).not.toHaveBeenCalled();
    });

    it('should reject update for already published schedule', async () => {
      const publishedSchedule = {
        pk: 'SCHEDULE#test-123',
        sk: 'METADATA',
        scheduleId: 'test-123',
        status: 'published',
        campaignId: 'campaign-456',
      };

      mockDynamoSend.mockResolvedValueOnce({ Item: publishedSchedule });

      await expect(scheduleService.updateSchedule(updateRequest))
        .rejects.toThrow(ServiceError);

      expect(mockDynamoSend).toHaveBeenCalledTimes(1);
      expect(mockSchedulerSend).not.toHaveBeenCalled();
    });
  });

  describe('cancelSchedule', () => {
    it('should successfully cancel pending schedule', async () => {
      const existingSchedule = {
        pk: 'SCHEDULE#test-123',
        sk: 'METADATA',
        scheduleId: 'test-123',
        status: 'pending',
      };

      mockDynamoSend.mockResolvedValueOnce({ Item: existingSchedule }); // GetCommand
      mockDynamoSend.mockResolvedValueOnce({}); // UpdateCommand
      mockSchedulerSend.mockResolvedValueOnce({}); // DeleteScheduleCommand
      mockEventBridgeSend.mockResolvedValueOnce({}); // PutEventsCommand

      const result = await scheduleService.cancelSchedule('test-123');

      expect(result.success).toBe(true);
      expect(result.message).toContain('cancelled successfully');

      // Verify DynamoDB update
      expect(mockDynamoSend).toHaveBeenCalledTimes(2);

      // Verify EventBridge schedule deletion
      expect(mockSchedulerSend).toHaveBeenCalledTimes(1);

      // Verify cancellation event
      expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);
    });

    it('should reject cancellation of already published schedule', async () => {
      const publishedSchedule = {
        pk: 'SCHEDULE#test-123',
        sk: 'METADATA',
        scheduleId: 'test-123',
        status: 'published',
      };

      mockDynamoSend.mockResolvedValueOnce({ Item: publishedSchedule });

      await expect(scheduleService.cancelSchedule('test-123'))
        .rejects.toThrow(ServiceError);

      expect(mockDynamoSend).toHaveBeenCalledTimes(1);
      expect(mockSchedulerSend).not.toHaveBeenCalled();
    });
  });

  describe('getSchedulesByBrand', () => {
    it('should retrieve schedules for a brand', async () => {
      const mockSchedules = [
        {
          pk: 'SCHEDULE#test-1',
          sk: 'METADATA',
          scheduleId: 'test-1',
          brandId: 'brand-789',
          status: 'pending',
        },
        {
          pk: 'SCHEDULE#test-2',
          sk: 'METADATA',
          scheduleId: 'test-2',
          brandId: 'brand-789',
          status: 'published',
        },
      ];

      mockDynamoSend.mockResolvedValueOnce({
        Items: mockSchedules,
        LastEvaluatedKey: undefined,
      });

      const result = await scheduleService.getSchedulesByBrand('brand-789', { limit: 10 });

      expect(result.schedules).toEqual(mockSchedules);
      expect(result.nextToken).toBeUndefined();
      expect(mockDynamoSend).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'QueryCommand',
          params: expect.objectContaining({
            TableName: 'test-schedules-table',
            IndexName: 'BrandIndex',
            KeyConditionExpression: 'brandId = :brandId',
          }),
        })
      );
    });

    it('should handle pagination correctly', async () => {
      const mockSchedules = [
        {
          pk: 'SCHEDULE#test-1',
          sk: 'METADATA',
          scheduleId: 'test-1',
          brandId: 'brand-789',
        },
      ];

      const lastEvaluatedKey = { pk: 'SCHEDULE#test-1', sk: 'METADATA' };

      mockDynamoSend.mockResolvedValueOnce({
        Items: mockSchedules,
        LastEvaluatedKey: lastEvaluatedKey,
      });

      const result = await scheduleService.getSchedulesByBrand('brand-789', { limit: 1 });

      expect(result.schedules).toEqual(mockSchedules);
      expect(result.nextToken).toBeDefined();
    });
  });
});