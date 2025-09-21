import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CampaignEventHandler, type EventBridgeEvent } from './campaign-event-handler';

// Mock services
vi.mock('../services/campaign-service', () => ({
  CampaignService: vi.fn(() => ({
    getCampaign: vi.fn(),
    updateCampaign: vi.fn(),
    getCampaignsByBrand: vi.fn(),
  })),
}));

vi.mock('../services/schedule-service', () => ({
  ScheduleService: vi.fn(() => ({
    createSchedule: vi.fn(),
    getSchedule: vi.fn(),
    updateSchedule: vi.fn(),
    cancelSchedule: vi.fn(),
    getSchedulesByBrand: vi.fn(),
    getSchedulesByCampaign: vi.fn(),
    pauseSchedulesByCampaign: vi.fn(),
    resumeSchedulesByCampaign: vi.fn(),
    cancelSchedulesByCampaign: vi.fn(),
  })),
}));

vi.mock('@postolio/aws', () => ({
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

describe('CampaignEventHandler', () => {
  let campaignEventHandler: CampaignEventHandler;
  let mockCampaignService: {
    updateCampaign: ReturnType<typeof vi.fn>;
    createCampaignRecord: ReturnType<typeof vi.fn>;
    getCampaign: ReturnType<typeof vi.fn>;
    updateCampaignStatus: ReturnType<typeof vi.fn>;
    listCampaigns: ReturnType<typeof vi.fn>;
    healthCheck: ReturnType<typeof vi.fn>;
  };
  let mockScheduleService: {
    pauseSchedulesByCampaign: ReturnType<typeof vi.fn>;
    resumeSchedulesByCampaign: ReturnType<typeof vi.fn>;
    cancelSchedulesByCampaign: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    campaignEventHandler = new CampaignEventHandler();

    // Get the mock instances
    mockCampaignService = (campaignEventHandler as unknown as { campaignService: typeof mockCampaignService }).campaignService;
    mockScheduleService = (campaignEventHandler as unknown as { scheduleService: typeof mockScheduleService }).scheduleService;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handle', () => {
    it('should handle campaign.created events', async () => {
      const event: EventBridgeEvent = {
        'detail-type': 'campaign.created',
        source: 'postolio.platform',
        detail: {
          campaignId: 'campaign-456',
          brandId: 'brand-789',
          userId: 'user-012',
          name: 'Test Campaign',
          status: 'active',
          contentIds: ['content-1', 'content-2'],
          createdAt: '2024-01-01T10:00:00Z',
          timestamp: '2024-01-01T10:00:00Z',
        },
      };

      mockCampaignService.updateCampaign.mockResolvedValue({
        success: true,
        message: 'Campaign synced successfully',
      });

      await campaignEventHandler.handle(event);

      expect(mockCampaignService.updateCampaign).toHaveBeenCalledWith(
        'campaign-456',
        {
          campaignId: 'campaign-456',
          brandId: 'brand-789',
          userId: 'user-012',
          name: 'Test Campaign',
          status: 'active',
          contentIds: ['content-1', 'content-2'],
          createdAt: '2024-01-01T10:00:00Z',
          timestamp: '2024-01-01T10:00:00Z',
        }
      );
    });

    it('should handle campaign.status.changed events - paused', async () => {
      const event: EventBridgeEvent = {
        'detail-type': 'campaign.status.changed',
        source: 'postolio.platform',
        detail: {
          campaignId: 'campaign-456',
          brandId: 'brand-789',
          previousStatus: 'active',
          newStatus: 'paused',
          reason: 'Manual pause by user',
          changedAt: '2024-01-01T10:00:00Z',
          timestamp: '2024-01-01T10:00:00Z',
        },
      };

      mockCampaignService.updateCampaign.mockResolvedValue({
        success: true,
        message: 'Campaign status updated',
      });

      mockScheduleService.pauseSchedulesByCampaign.mockResolvedValue({
        success: true,
        pausedCount: 5,
        message: '5 schedules paused',
      });

      await campaignEventHandler.handle(event);

      expect(mockCampaignService.updateCampaign).toHaveBeenCalledWith(
        'campaign-456',
        {
          status: 'paused',
          statusChangedAt: '2024-01-01T10:00:00Z',
        }
      );

      expect(mockScheduleService.pauseSchedulesByCampaign).toHaveBeenCalledWith('campaign-456');
    });

    it('should handle campaign.status.changed events - resumed', async () => {
      const event: EventBridgeEvent = {
        'detail-type': 'campaign.status.changed',
        source: 'postolio.platform',
        detail: {
          campaignId: 'campaign-456',
          brandId: 'brand-789',
          previousStatus: 'paused',
          newStatus: 'active',
          reason: 'Manual resume by user',
          changedAt: '2024-01-01T10:00:00Z',
          timestamp: '2024-01-01T10:00:00Z',
        },
      };

      mockCampaignService.updateCampaign.mockResolvedValue({
        success: true,
        message: 'Campaign status updated',
      });

      mockScheduleService.resumeSchedulesByCampaign.mockResolvedValue({
        success: true,
        resumedCount: 3,
        message: '3 schedules resumed',
      });

      await campaignEventHandler.handle(event);

      expect(mockCampaignService.updateCampaign).toHaveBeenCalledWith(
        'campaign-456',
        {
          status: 'active',
          statusChangedAt: '2024-01-01T10:00:00Z',
        }
      );

      expect(mockScheduleService.resumeSchedulesByCampaign).toHaveBeenCalledWith('campaign-456');
    });

    it('should handle campaign.status.changed events - cancelled', async () => {
      const event: EventBridgeEvent = {
        'detail-type': 'campaign.status.changed',
        source: 'postolio.platform',
        detail: {
          campaignId: 'campaign-456',
          brandId: 'brand-789',
          previousStatus: 'active',
          newStatus: 'cancelled',
          reason: 'Campaign ended',
          changedAt: '2024-01-01T10:00:00Z',
          timestamp: '2024-01-01T10:00:00Z',
        },
      };

      mockCampaignService.updateCampaign.mockResolvedValue({
        success: true,
        message: 'Campaign status updated',
      });

      mockScheduleService.cancelSchedulesByCampaign.mockResolvedValue({
        success: true,
        cancelledCount: 8,
        message: '8 schedules cancelled',
      });

      await campaignEventHandler.handle(event);

      expect(mockCampaignService.updateCampaign).toHaveBeenCalledWith(
        'campaign-456',
        {
          status: 'cancelled',
          statusChangedAt: '2024-01-01T10:00:00Z',
        }
      );

      expect(mockScheduleService.cancelSchedulesByCampaign).toHaveBeenCalledWith('campaign-456');
    });

    it('should ignore unsupported event types', async () => {
      const event: EventBridgeEvent = {
        'detail-type': 'unsupported.event',
        source: 'postolio.platform',
        detail: {
          campaignId: 'campaign-unsupported',
          brandId: 'brand-unsupported',
          timestamp: '2024-01-01T10:00:00Z',
          someData: 'value',
        },
      };

      await campaignEventHandler.handle(event);

      expect(mockCampaignService.updateCampaign).not.toHaveBeenCalled();
      expect(mockScheduleService.pauseSchedulesByCampaign).not.toHaveBeenCalled();
      expect(mockScheduleService.resumeSchedulesByCampaign).not.toHaveBeenCalled();
      expect(mockScheduleService.cancelSchedulesByCampaign).not.toHaveBeenCalled();
    });

    it('should handle service errors gracefully', async () => {
      const event: EventBridgeEvent = {
        'detail-type': 'campaign.created',
        source: 'postolio.platform',
        detail: {
          campaignId: 'campaign-456',
          brandId: 'brand-789',
          userId: 'user-012',
          name: 'Test Campaign',
          status: 'active',
          timestamp: '2024-01-01T10:00:00Z',
        },
      };

      mockCampaignService.updateCampaign.mockRejectedValue(
        new Error('Database connection failed')
      );

      // Should not throw - errors should be logged and handled gracefully
      await expect(campaignEventHandler.handle(event)).resolves.toBeUndefined();

      expect(mockCampaignService.updateCampaign).toHaveBeenCalled();
    });

    it('should handle missing campaign ID gracefully', async () => {
      const event: EventBridgeEvent = {
        'detail-type': 'campaign.created',
        source: 'postolio.platform',
        detail: {
          // Missing campaignId
          brandId: 'brand-789',
          userId: 'user-012',
          name: 'Test Campaign',
          status: 'active',
          campaignId: '',
          timestamp: '2024-01-01T10:00:00Z',
        },
      };

      // Should not throw - should handle missing data gracefully
      await expect(campaignEventHandler.handle(event)).resolves.toBeUndefined();

      expect(mockCampaignService.updateCampaign).not.toHaveBeenCalled();
    });

    it('should handle schedule service errors during status changes', async () => {
      const event: EventBridgeEvent = {
        'detail-type': 'campaign.status.changed',
        source: 'postolio.platform',
        detail: {
          campaignId: 'campaign-456',
          brandId: 'brand-789',
          previousStatus: 'active',
          newStatus: 'paused',
          changedAt: '2024-01-01T10:00:00Z',
          timestamp: '2024-01-01T10:00:00Z',
        },
      };

      mockCampaignService.updateCampaign.mockResolvedValue({
        success: true,
        message: 'Campaign status updated',
      });

      mockScheduleService.pauseSchedulesByCampaign.mockRejectedValue(
        new Error('Failed to pause schedules')
      );

      // Should not throw - should handle schedule service errors gracefully
      await expect(campaignEventHandler.handle(event)).resolves.toBeUndefined();

      expect(mockCampaignService.updateCampaign).toHaveBeenCalled();
      expect(mockScheduleService.pauseSchedulesByCampaign).toHaveBeenCalled();
    });
  });

  describe('event validation', () => {
    it('should validate campaign.created event structure', async () => {
      const invalidEvent: EventBridgeEvent = {
        'detail-type': 'campaign.created',
        source: 'postolio.platform',
        detail: {
          campaignId: 'c-1',
          brandId: 'b-1',
          timestamp: 't-1',
        },
      };

      // Should handle invalid event structure gracefully
      await expect(campaignEventHandler.handle(invalidEvent)).resolves.toBeUndefined();

      expect(mockCampaignService.updateCampaign).not.toHaveBeenCalled();
    });

    it('should validate campaign.status.changed event structure', async () => {
      const invalidEvent: EventBridgeEvent = {
        'detail-type': 'campaign.status.changed',
        source: 'postolio.platform',
        detail: {
          // Missing required fields
          campaignId: 'campaign-456',
          brandId: 'brand-456',
          timestamp: '2024-01-01T10:00:00Z',
          // Missing previousStatus, newStatus
        },
      };

      // Should handle incomplete event data gracefully
      await expect(campaignEventHandler.handle(invalidEvent)).resolves.toBeUndefined();

      expect(mockCampaignService.updateCampaign).toHaveBeenCalledWith(
        'campaign-456',
        expect.objectContaining({
          status: undefined,
        })
      );
    });
  });

  describe('concurrency handling', () => {
    it('should handle multiple concurrent events for same campaign', async () => {
      const event1: EventBridgeEvent = {
        'detail-type': 'campaign.status.changed',
        source: 'postolio.platform',
        detail: {
          campaignId: 'campaign-456',
          brandId: 'brand-456',
          previousStatus: 'active',
          newStatus: 'paused',
          changedAt: '2024-01-01T10:00:00Z',
          timestamp: '2024-01-01T10:00:00Z',
        },
      };

      const event2: EventBridgeEvent = {
        'detail-type': 'campaign.status.changed',
        source: 'postolio.platform',
        detail: {
          campaignId: 'campaign-456',
          brandId: 'brand-456',
          previousStatus: 'paused',
          newStatus: 'active',
          changedAt: '2024-01-01T10:01:00Z',
          timestamp: '2024-01-01T10:01:00Z',
        },
      };

      mockCampaignService.updateCampaign.mockResolvedValue({
        success: true,
        message: 'Campaign updated',
      });
      mockScheduleService.pauseSchedulesByCampaign.mockResolvedValue({
        success: true,
        pausedCount: 5,
      });
      mockScheduleService.resumeSchedulesByCampaign.mockResolvedValue({
        success: true,
        resumedCount: 5,
      });

      // Process events concurrently
      await Promise.all([
        campaignEventHandler.handle(event1),
        campaignEventHandler.handle(event2),
      ]);

      expect(mockCampaignService.updateCampaign).toHaveBeenCalledTimes(2);
      expect(mockScheduleService.pauseSchedulesByCampaign).toHaveBeenCalledTimes(1);
      expect(mockScheduleService.resumeSchedulesByCampaign).toHaveBeenCalledTimes(1);
    });
  });
});
