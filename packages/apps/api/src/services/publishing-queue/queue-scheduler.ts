import { getDatabaseClient } from '../../config/database.js';
import { schedulerService } from '../scheduler.js';
import { TimezoneService } from '../timezone.js';
import { SLOT_CONFLICT_WINDOW_MS, isTimeOccupied } from './occupancy.js';
import { generateSlotInstances, type LaneKey } from './slot-instance-generator.js';

const prisma = getDatabaseClient();

type ContentLaneKey = Exclude<LaneKey, 'any'>;

const CONTENT_LANES: ContentLaneKey[] = ['post', 'reel', 'story'];

function normalizeSlotLaneKey(value: unknown): LaneKey {
  if (value === 'reel' || value === 'story' || value === 'any') return value;
  return 'post';
}

function normalizeContentLaneKey(value: unknown): ContentLaneKey {
  if (value === 'reel' || value === 'story') return value;
  return 'post';
}

function isSkippableContentStatus(status: unknown): boolean {
  return (
    status === 'published' ||
    status === 'unavailable' ||
    status === 'failed' ||
    status === 'skipped'
  );
}

export class PublishingQueueSchedulerService {
  static readonly SLOT_CONFLICT_WINDOW_MS = SLOT_CONFLICT_WINDOW_MS;
  static readonly SCHEDULING_BUFFER_MS = 5 * 60 * 1000; // 5 minutes from "now"
  static readonly MAX_WINDOW_SIZE = 100; // avoid churn; tunable
  static readonly SLOT_SCAN_LIMIT_PER_ACCOUNT = 400; // upcoming slot instances per account

  /**
   * Recompute the queue-managed scheduling window for a brand across ALL of its social accounts.
   *
   * - Computes upcoming slot instances per social account (brand timezone)
   * - Skips reserved fixed-time/campaign schedules (per social account)
   * - Assigns queued items to slot instances (per queueId + laneKey) in chronological order
   * - Cancels queue-managed schedules that fall outside the window
   * - Schedules/reschedules queue-managed items inside the window
   */
  async recomputeBrandWindow(brandId: string): Promise<{
    success: boolean;
    windowSize: number;
    assigned: number;
    scheduled: number;
    rescheduled: number;
    cancelled: number;
    errors: Array<{ contentId: string; operation: string; error: string }>;
  }> {
    const now = new Date();
    const startAtUtc = new Date(
      now.getTime() + PublishingQueueSchedulerService.SCHEDULING_BUFFER_MS
    );

    const brand = await prisma.brand.findUnique({
      where: { id: brandId },
      select: { id: true, userId: true, user: { select: { subscriptionTier: true } } },
    });
    if (!brand) {
      return {
        success: false,
        windowSize: 0,
        assigned: 0,
        scheduled: 0,
        rescheduled: 0,
        cancelled: 0,
        errors: [{ contentId: brandId, operation: 'load_brand', error: 'Brand not found' }],
      };
    }

    const tier = brand.user?.subscriptionTier || 'free';
    const { getMaxScheduledAheadForTier } = await import('../../constants/subscription.js');
    const maxAhead = getMaxScheduledAheadForTier(tier);

    const reservedCount = await prisma.content.count({
      where: {
        brandId,
        scheduledAt: { gte: now },
        status: { in: ['scheduled', 'draft'] },
        publishingQueueItem: { is: null },
      },
    });

    const windowSize = (() => {
      if (!Number.isFinite(maxAhead)) return PublishingQueueSchedulerService.MAX_WINDOW_SIZE;
      const remaining = Math.max(0, (maxAhead as number) - reservedCount);
      return Math.min(PublishingQueueSchedulerService.MAX_WINDOW_SIZE, remaining);
    })();

    if (windowSize <= 0) {
      // Still cancel any queue-managed scheduled items to respect cap.
      const queueManagedScheduled = await prisma.content.findMany({
        where: {
          brandId,
          scheduledAt: { gte: now },
          status: { in: ['scheduled'] },
          publishingQueueItem: { isNot: null },
        },
        select: { id: true },
      });

      const errors: Array<{ contentId: string; operation: string; error: string }> = [];
      let cancelled = 0;
      for (const c of queueManagedScheduled) {
        const result = await schedulerService.cancelScheduledPost(c.id);
        if (!result.success) {
          errors.push({
            contentId: c.id,
            operation: 'cancel',
            error: result.error || 'cancel_failed',
          });
        } else {
          cancelled += 1;
        }
      }

      return {
        success: errors.length === 0,
        windowSize,
        assigned: 0,
        scheduled: 0,
        rescheduled: 0,
        cancelled,
        errors,
      };
    }

    const timezone = await TimezoneService.getBrandTimezone(brandId);

    // Load queue slots (active queues only)
    const slots = await prisma.publishingQueueSlot.findMany({
      where: {
        enabled: true,
        queue: {
          paused: false,
          socialAccount: { brandId },
        },
      },
      select: {
        id: true,
        queueId: true,
        socialAccountId: true,
        laneKey: true,
        dayOfWeek: true,
        localTime: true,
      },
    });

    // Load queue items with content (including paused queues so we can cancel schedules)
    const queueItems = await prisma.publishingQueueItem.findMany({
      where: {
        queue: {
          socialAccount: { brandId },
        },
      },
      include: {
        queue: { select: { socialAccountId: true, paused: true } },
        content: {
          select: {
            id: true,
            status: true,
            scheduledAt: true,
            contentType: true,
            targetSocialAccountId: true,
            brandId: true,
          },
        },
      },
      orderBy: [{ queueId: 'asc' }, { laneKey: 'asc' }, { position: 'asc' }],
    });

    const pruneItemIds = queueItems
      .filter(
        (item) =>
          item.content &&
          (item.content.status === 'published' || item.content.status === 'unavailable')
      )
      .map((item) => item.id);

    if (pruneItemIds.length > 0) {
      await prisma.publishingQueueItem.deleteMany({
        where: { id: { in: pruneItemIds } },
      });
    }

    const prunedIdSet = new Set(pruneItemIds);
    const activeQueueItems = queueItems.filter((item) => !prunedIdSet.has(item.id));

    // Reserved (non-queue) scheduled times per social account
    const reservedScheduled = await prisma.content.findMany({
      where: {
        brandId,
        scheduledAt: { gte: startAtUtc },
        status: { in: ['scheduled', 'draft', 'skipped'] },
        publishingQueueItem: { is: null },
        targetSocialAccountId: { not: null },
      },
      select: { targetSocialAccountId: true, scheduledAt: true },
    });

    const reservedTimesByAccount = new Map<string, number[]>();
    for (const r of reservedScheduled) {
      const socialAccountId = r.targetSocialAccountId;
      if (!socialAccountId || !r.scheduledAt) continue;
      const ms = r.scheduledAt.getTime();
      const list = reservedTimesByAccount.get(socialAccountId) ?? [];
      list.push(ms);
      reservedTimesByAccount.set(socialAccountId, list);
    }
    for (const [k, list] of reservedTimesByAccount.entries()) {
      list.sort((a, b) => a - b);
      reservedTimesByAccount.set(k, list);
    }

    // Slot instances per social account (after removing reserved times)
    const slotsByAccount = new Map<string, typeof slots>();
    for (const slot of slots) {
      const list = slotsByAccount.get(slot.socialAccountId) ?? [];
      list.push(slot);
      slotsByAccount.set(slot.socialAccountId, list);
    }

    type GlobalSlotInstance = {
      socialAccountId: string;
      slotId: string;
      queueId: string;
      laneKey: LaneKey;
      scheduledAtUtc: Date;
    };

    const candidateInstances: GlobalSlotInstance[] = [];
    for (const [socialAccountId, accountSlots] of slotsByAccount.entries()) {
      const templates = accountSlots.map((s) => ({
        slotId: s.id,
        queueId: s.queueId,
        laneKey: normalizeSlotLaneKey(s.laneKey),
        dayOfWeek: s.dayOfWeek,
        localTime: s.localTime,
      }));

      const instances = generateSlotInstances({
        slots: templates,
        timezone,
        startAtUtc,
        limit: PublishingQueueSchedulerService.SLOT_SCAN_LIMIT_PER_ACCOUNT,
      });

      const reserved = reservedTimesByAccount.get(socialAccountId) ?? [];
      for (const inst of instances) {
        const ms = inst.scheduledAtUtc.getTime();
        if (
          isTimeOccupied({
            candidateUtcMs: ms,
            occupiedUtcMsSorted: reserved,
            windowMs: PublishingQueueSchedulerService.SLOT_CONFLICT_WINDOW_MS,
          })
        ) {
          continue;
        }
        candidateInstances.push({
          socialAccountId,
          slotId: inst.slotId,
          queueId: inst.queueId,
          laneKey: inst.laneKey,
          scheduledAtUtc: inst.scheduledAtUtc,
        });
      }
    }

    candidateInstances.sort((a, b) => a.scheduledAtUtc.getTime() - b.scheduledAtUtc.getTime());

    type QueueItemRow = (typeof queueItems)[number];
    const queueLaneKeyOf = (queueId: string, laneKey: LaneKey) => `${queueId}:${laneKey}`;

    const itemsByQueueLane = new Map<string, QueueItemRow[]>();
    const itemIndexByQueueLane = new Map<string, number>();

    for (const item of activeQueueItems) {
      const content = item.content;
      if (!content) continue;
      if (content.brandId !== brandId) continue;
      const expectedSocialAccountId = item.queue.socialAccountId;
      if (!expectedSocialAccountId) continue;
      if (item.queue.paused) continue;
      if (content.targetSocialAccountId !== expectedSocialAccountId) continue;
      if (isSkippableContentStatus(content.status)) continue;

      const laneKey = normalizeContentLaneKey(content.contentType ?? item.laneKey);
      const key = queueLaneKeyOf(item.queueId, laneKey);
      const list = itemsByQueueLane.get(key) ?? [];
      list.push(item);
      itemsByQueueLane.set(key, list);
      if (!itemIndexByQueueLane.has(key)) itemIndexByQueueLane.set(key, 0);
    }

    // Ensure each list is position-ordered (laneKey normalization can reshuffle)
    for (const [key, list] of itemsByQueueLane.entries()) {
      list.sort((a, b) => a.position - b.position);
      itemsByQueueLane.set(key, list);
    }

    const desiredSchedule = new Map<string, Date>();

    const peekNextEligibleItem = (
      queueId: string,
      laneKey: ContentLaneKey,
      scheduledAtUtc: Date
    ): { item: QueueItemRow; index: number } | null => {
      const key = queueLaneKeyOf(queueId, laneKey);
      const list = itemsByQueueLane.get(key);
      if (!list || list.length === 0) return null;

      let idx = itemIndexByQueueLane.get(key) ?? 0;
      while (idx < list.length) {
        const item = list[idx]!;
        const content = item.content;
        if (!content || isSkippableContentStatus(content.status)) {
          idx += 1;
          continue;
        }

        if (item.notBefore && scheduledAtUtc.getTime() < item.notBefore.getTime()) {
          // Respect schedule-after by leaving a gap until the first slot >= notBefore.
          itemIndexByQueueLane.set(key, idx);
          return null;
        }

        itemIndexByQueueLane.set(key, idx);
        return { item, index: idx };
      }

      itemIndexByQueueLane.set(key, idx);
      return null;
    };

    for (const inst of candidateInstances) {
      if (desiredSchedule.size >= windowSize) break;

      if (inst.laneKey === 'any') {
        const candidates = CONTENT_LANES.map((lane) => ({
          lane,
          peek: peekNextEligibleItem(inst.queueId, lane, inst.scheduledAtUtc),
        })).filter(
          (c): c is { lane: ContentLaneKey; peek: { item: QueueItemRow; index: number } } =>
            Boolean(c.peek)
        );

        if (candidates.length === 0) continue;

        candidates.sort((a, b) => {
          const aMs = a.peek.item.createdAt.getTime();
          const bMs = b.peek.item.createdAt.getTime();
          if (aMs !== bMs) return aMs - bMs;
          return a.peek.item.contentId.localeCompare(b.peek.item.contentId);
        });

        const chosen = candidates[0]!;
        const content = chosen.peek.item.content;
        if (!content) continue;

        desiredSchedule.set(content.id, inst.scheduledAtUtc);
        const key = queueLaneKeyOf(inst.queueId, chosen.lane);
        itemIndexByQueueLane.set(key, chosen.peek.index + 1);
        continue;
      }

      const laneKey = inst.laneKey as ContentLaneKey;
      const peek = peekNextEligibleItem(inst.queueId, laneKey, inst.scheduledAtUtc);
      if (!peek) continue;
      const content = peek.item.content;
      if (!content) continue;

      desiredSchedule.set(content.id, inst.scheduledAtUtc);
      const key = queueLaneKeyOf(inst.queueId, laneKey);
      itemIndexByQueueLane.set(key, peek.index + 1);
    }

    // Compute operations
    const toCancel: string[] = [];
    const toReschedule: Array<{ contentId: string; scheduledAt: Date }> = [];
    const toSchedule: Array<{ contentId: string; scheduledAt: Date }> = [];

    for (const item of activeQueueItems) {
      const content = item.content;
      if (!content) continue;
      if (content.brandId !== brandId) continue;
      const expectedSocialAccountId = item.queue.socialAccountId;
      if (!expectedSocialAccountId) continue;
      if (content.targetSocialAccountId !== expectedSocialAccountId) continue;

      const desired = desiredSchedule.get(content.id) ?? null;
      const isScheduled = content.status === 'scheduled' && Boolean(content.scheduledAt);

      if (item.queue.paused) {
        if (isScheduled) toCancel.push(content.id);
        continue;
      }

      if (!desired) {
        if (isScheduled) {
          toCancel.push(content.id);
        }
        continue;
      }

      if (isScheduled) {
        const currentMs = content.scheduledAt!.getTime();
        const desiredMs = desired.getTime();
        if (currentMs !== desiredMs) {
          toReschedule.push({ contentId: content.id, scheduledAt: desired });
        }
      } else {
        toSchedule.push({ contentId: content.id, scheduledAt: desired });
      }
    }

    // Execute operations (cancel first to free capacity)
    const errors: Array<{ contentId: string; operation: string; error: string }> = [];
    let cancelled = 0;
    for (const contentId of toCancel) {
      const result = await schedulerService.cancelScheduledPost(contentId);
      if (!result.success) {
        errors.push({ contentId, operation: 'cancel', error: result.error || 'cancel_failed' });
      } else {
        cancelled += 1;
      }
    }

    let rescheduled = 0;
    for (const op of toReschedule) {
      const result = await schedulerService.reschedulePost(op.contentId, op.scheduledAt);
      if (!result.success) {
        errors.push({
          contentId: op.contentId,
          operation: 'reschedule',
          error: result.error || 'reschedule_failed',
        });
      } else {
        rescheduled += 1;
      }
    }

    let scheduled = 0;
    for (const op of toSchedule) {
      const result = await schedulerService.scheduleContent(op.contentId, op.scheduledAt);
      if (!result.success) {
        errors.push({
          contentId: op.contentId,
          operation: 'schedule',
          error: result.error || 'schedule_failed',
        });
      } else {
        scheduled += 1;
      }
    }

    return {
      success: errors.length === 0,
      windowSize,
      assigned: desiredSchedule.size,
      scheduled,
      rescheduled,
      cancelled,
      errors,
    };
  }
}

export const publishingQueueScheduler = new PublishingQueueSchedulerService();
