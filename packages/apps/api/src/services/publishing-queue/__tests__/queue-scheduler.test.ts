import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDatabaseClient } from '../../../config/database.js';
import { getMaxScheduledAheadForTier } from '../../../constants/subscription.js';
import { schedulerService } from '../../scheduler.js';
import { TimezoneService } from '../../timezone.js';
import { publishingQueueScheduler } from '../queue-scheduler.js';

vi.mock('../../../config/database.js', () => {
  const prisma = {
    brand: {
      findUnique: vi.fn(),
    },
    content: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    publishingQueueSlot: {
      findMany: vi.fn(),
    },
    publishingQueueItem: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  } as any;

  return {
    getDatabaseUrl: vi.fn(() => 'postgresql://test:test@localhost:5432/test?schema=public'),
    getDatabaseClient: vi.fn(() => prisma),
    prisma,
  };
});

vi.mock('../../scheduler.js', () => ({
  schedulerService: {
    scheduleContent: vi.fn(async () => ({ success: true })),
    reschedulePost: vi.fn(async () => ({ success: true })),
    cancelScheduledPost: vi.fn(async () => ({ success: true })),
  },
}));

vi.mock('../../timezone.js', () => ({
  TimezoneService: {
    getBrandTimezone: vi.fn(async () => 'UTC'),
  },
}));

vi.mock('../../../constants/subscription.js', () => ({
  getMaxScheduledAheadForTier: vi.fn(() => 10),
  getMaxQueueDepthForTier: vi.fn(() => 10),
}));

describe('PublishingQueueSchedulerService', () => {
  let prisma: any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-06T10:00:00.000Z')); // Monday 10:00 UTC
    vi.clearAllMocks();

    prisma = getDatabaseClient();
    vi.mocked(TimezoneService.getBrandTimezone).mockResolvedValue('UTC');
    vi.mocked(getMaxScheduledAheadForTier).mockReturnValue(10);

    vi.mocked(prisma.brand.findUnique).mockResolvedValue({
      id: 'brand-1',
      userId: 'user-1',
      user: { subscriptionTier: 'free' },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules the next available slot for the lane, skipping reserved times for that social account', async () => {
    vi.mocked(prisma.content.count).mockResolvedValue(1);

    vi.mocked(prisma.publishingQueueSlot.findMany).mockResolvedValue([
      {
        id: 'slot-1100',
        queueId: 'queue-1',
        socialAccountId: 'sa-1',
        laneKey: 'post',
        dayOfWeek: 1,
        localTime: '11:00',
      },
      {
        id: 'slot-1130',
        queueId: 'queue-1',
        socialAccountId: 'sa-1',
        laneKey: 'post',
        dayOfWeek: 1,
        localTime: '11:30',
      },
    ]);

    vi.mocked(prisma.publishingQueueItem.findMany).mockResolvedValue([
      {
        id: 'item-1',
        queueId: 'queue-1',
        laneKey: 'post',
        position: 1,
        notBefore: null,
        queue: { socialAccountId: 'sa-1', paused: false },
        content: {
          id: 'content-1',
          status: 'draft',
          scheduledAt: null,
          contentType: 'post',
          targetSocialAccountId: 'sa-1',
          brandId: 'brand-1',
        },
      },
    ]);

    vi.mocked(prisma.publishingQueueItem.deleteMany).mockResolvedValue({ count: 0 });

    vi.mocked(prisma.content.findMany).mockResolvedValue([
      // Reserve the first slot (11:00) so queue lands at 11:30.
      {
        targetSocialAccountId: 'sa-1',
        scheduledAt: new Date('2025-01-06T11:00:00.000Z'),
      },
    ]);

    const result = await publishingQueueScheduler.recomputeBrandWindow('brand-1');

    expect(result.success).toBe(true);
    expect(result.assigned).toBe(1);
    expect(result.scheduled).toBe(1);
    expect(vi.mocked(schedulerService.scheduleContent)).toHaveBeenCalledWith(
      'content-1',
      new Date('2025-01-06T11:30:00.000Z')
    );
    expect(vi.mocked(schedulerService.cancelScheduledPost)).not.toHaveBeenCalled();
    expect(vi.mocked(schedulerService.reschedulePost)).not.toHaveBeenCalled();
  });

  it('fills "any" slots with the oldest queued item across lanes', async () => {
    vi.mocked(prisma.content.count).mockResolvedValue(0);

    vi.mocked(prisma.publishingQueueSlot.findMany).mockResolvedValue([
      {
        id: 'slot-any-1100',
        queueId: 'queue-1',
        socialAccountId: 'sa-1',
        laneKey: 'any',
        dayOfWeek: 1,
        localTime: '11:00',
      },
    ]);

    vi.mocked(prisma.publishingQueueItem.findMany).mockResolvedValue([
      {
        id: 'item-post-1',
        queueId: 'queue-1',
        contentId: 'content-1',
        laneKey: 'post',
        position: 1,
        createdAt: new Date('2025-01-06T09:00:00.000Z'),
        notBefore: null,
        queue: { socialAccountId: 'sa-1', paused: false },
        content: {
          id: 'content-1',
          status: 'draft',
          scheduledAt: null,
          contentType: 'post',
          targetSocialAccountId: 'sa-1',
          brandId: 'brand-1',
        },
      },
      {
        id: 'item-reel-1',
        queueId: 'queue-1',
        contentId: 'content-2',
        laneKey: 'reel',
        position: 1,
        createdAt: new Date('2025-01-06T09:30:00.000Z'),
        notBefore: null,
        queue: { socialAccountId: 'sa-1', paused: false },
        content: {
          id: 'content-2',
          status: 'draft',
          scheduledAt: null,
          contentType: 'reel',
          targetSocialAccountId: 'sa-1',
          brandId: 'brand-1',
        },
      },
    ]);

    vi.mocked(prisma.publishingQueueItem.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.content.findMany).mockResolvedValue([]);

    const result = await publishingQueueScheduler.recomputeBrandWindow('brand-1');

    expect(result.success).toBe(true);
    expect(result.assigned).toBe(2);
    expect(vi.mocked(schedulerService.scheduleContent)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(schedulerService.scheduleContent)).toHaveBeenCalledWith(
      'content-1',
      new Date('2025-01-06T11:00:00.000Z')
    );
    expect(vi.mocked(schedulerService.scheduleContent)).toHaveBeenCalledWith(
      'content-2',
      new Date('2025-01-13T11:00:00.000Z')
    );
  });

  it('cancels queue-managed schedules when the brand scheduling cap is exhausted', async () => {
    vi.mocked(getMaxScheduledAheadForTier).mockReturnValue(1);
    vi.mocked(prisma.content.count).mockResolvedValue(1);

    vi.mocked(prisma.content.findMany).mockResolvedValue([
      { id: 'content-q-1' },
      { id: 'content-q-2' },
    ]);

    const result = await publishingQueueScheduler.recomputeBrandWindow('brand-1');

    expect(result.windowSize).toBe(0);
    expect(vi.mocked(schedulerService.cancelScheduledPost)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(schedulerService.cancelScheduledPost)).toHaveBeenCalledWith('content-q-1');
    expect(vi.mocked(schedulerService.cancelScheduledPost)).toHaveBeenCalledWith('content-q-2');
    expect(vi.mocked(schedulerService.scheduleContent)).not.toHaveBeenCalled();
    expect(vi.mocked(schedulerService.reschedulePost)).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.publishingQueueSlot.findMany)).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.publishingQueueItem.findMany)).not.toHaveBeenCalled();
  });

  it('cancels scheduled queue items when their queue is paused', async () => {
    vi.mocked(prisma.content.count).mockResolvedValue(0);
    vi.mocked(prisma.publishingQueueSlot.findMany).mockResolvedValue([
      {
        id: 'slot-1100',
        queueId: 'queue-1',
        socialAccountId: 'sa-1',
        laneKey: 'post',
        dayOfWeek: 1,
        localTime: '11:00',
      },
    ]);

    vi.mocked(prisma.publishingQueueItem.findMany).mockResolvedValue([
      {
        id: 'item-1',
        queueId: 'queue-1',
        laneKey: 'post',
        position: 1,
        notBefore: null,
        queue: { socialAccountId: 'sa-1', paused: true },
        content: {
          id: 'content-1',
          status: 'scheduled',
          scheduledAt: new Date('2025-01-06T12:00:00.000Z'),
          contentType: 'post',
          targetSocialAccountId: 'sa-1',
          brandId: 'brand-1',
        },
      },
    ]);

    vi.mocked(prisma.publishingQueueItem.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.content.findMany).mockResolvedValue([]);

    const result = await publishingQueueScheduler.recomputeBrandWindow('brand-1');

    expect(result.cancelled).toBe(1);
    expect(vi.mocked(schedulerService.cancelScheduledPost)).toHaveBeenCalledWith('content-1');
    expect(vi.mocked(schedulerService.scheduleContent)).not.toHaveBeenCalled();
    expect(vi.mocked(schedulerService.reschedulePost)).not.toHaveBeenCalled();
  });

  it('reschedules queue-managed items when their desired slot changes', async () => {
    vi.mocked(prisma.content.count).mockResolvedValue(0);

    vi.mocked(prisma.publishingQueueSlot.findMany).mockResolvedValue([
      {
        id: 'slot-1100',
        queueId: 'queue-1',
        socialAccountId: 'sa-1',
        laneKey: 'post',
        dayOfWeek: 1,
        localTime: '11:00',
      },
    ]);

    vi.mocked(prisma.publishingQueueItem.findMany).mockResolvedValue([
      {
        id: 'item-1',
        queueId: 'queue-1',
        laneKey: 'post',
        position: 1,
        notBefore: null,
        queue: { socialAccountId: 'sa-1', paused: false },
        content: {
          id: 'content-1',
          status: 'scheduled',
          scheduledAt: new Date('2025-01-06T12:00:00.000Z'),
          contentType: 'post',
          targetSocialAccountId: 'sa-1',
          brandId: 'brand-1',
        },
      },
    ]);

    vi.mocked(prisma.publishingQueueItem.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.content.findMany).mockResolvedValue([]);

    const result = await publishingQueueScheduler.recomputeBrandWindow('brand-1');

    expect(result.rescheduled).toBe(1);
    expect(vi.mocked(schedulerService.reschedulePost)).toHaveBeenCalledWith(
      'content-1',
      new Date('2025-01-06T11:00:00.000Z')
    );
    expect(vi.mocked(schedulerService.scheduleContent)).not.toHaveBeenCalled();
    expect(vi.mocked(schedulerService.cancelScheduledPost)).not.toHaveBeenCalled();
  });
});
