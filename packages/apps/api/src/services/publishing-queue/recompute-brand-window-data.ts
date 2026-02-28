import { getDatabaseClient } from '../../config/database.js';
import { schedulerService } from '../scheduler.js';
import { isTimeOccupied } from './occupancy.js';
import { generateSlotInstances, type LaneKey } from './slot-instance-generator.js';

const prisma = getDatabaseClient();

export type QueueItemRow = any;

export type GlobalSlotInstance = {
  socialAccountId: string;
  slotId: string;
  queueId: string;
  laneKey: LaneKey;
  scheduledAtUtc: Date;
};

interface QueueSchedulerError {
  contentId: string;
  operation: string;
  error: string;
}

function normalizeSlotLaneKey(value: unknown): LaneKey {
  if (value === 'reel' || value === 'story' || value === 'any') {
    return value;
  }
  return 'post';
}

function groupSlotsByAccount(slots: any[]): Map<string, any[]> {
  const slotsByAccount = new Map<string, any[]>();
  for (const slot of slots) {
    const list = slotsByAccount.get(slot.socialAccountId) ?? [];
    list.push(slot);
    slotsByAccount.set(slot.socialAccountId, list);
  }
  return slotsByAccount;
}

function addUnoccupiedInstances(params: {
  socialAccountId: string;
  instances: Array<{ slotId: string; queueId: string; laneKey: LaneKey; scheduledAtUtc: Date }>;
  reserved: number[];
  slotConflictWindowMs: number;
  candidateInstances: GlobalSlotInstance[];
}): void {
  for (const instance of params.instances) {
    const candidateUtcMs = instance.scheduledAtUtc.getTime();
    const occupied = isTimeOccupied({
      candidateUtcMs,
      occupiedUtcMsSorted: params.reserved,
      windowMs: params.slotConflictWindowMs,
    });
    if (occupied) {
      continue;
    }
    params.candidateInstances.push({
      socialAccountId: params.socialAccountId,
      slotId: instance.slotId,
      queueId: instance.queueId,
      laneKey: instance.laneKey,
      scheduledAtUtc: instance.scheduledAtUtc,
    });
  }
}

export async function loadBrand(
  brandId: string
): Promise<{ user?: { subscriptionTier?: string } | null } | null> {
  return prisma.brand.findUnique({
    where: { id: brandId },
    select: { id: true, userId: true, user: { select: { subscriptionTier: true } } },
  });
}

export async function resolveWindowSize(params: {
  brandId: string;
  now: Date;
  tier: string;
  maxWindowSize: number;
}): Promise<number> {
  const { getMaxScheduledAheadForTier } = await import('../../constants/subscription.js');
  const maxAhead = getMaxScheduledAheadForTier(params.tier);

  const reservedCount = await prisma.content.count({
    where: {
      brandId: params.brandId,
      scheduledAt: { gte: params.now },
      status: { in: ['scheduled', 'draft'] },
      publishingQueueItem: { is: null },
    },
  });

  if (!Number.isFinite(maxAhead)) {
    return params.maxWindowSize;
  }

  const remaining = Math.max(0, (maxAhead as number) - reservedCount);
  return Math.min(params.maxWindowSize, remaining);
}

export async function cancelQueueManagedScheduledContent(
  brandId: string,
  now: Date,
  windowSize: number
): Promise<{
  success: boolean;
  windowSize: number;
  assigned: number;
  scheduled: number;
  rescheduled: number;
  cancelled: number;
  errors: QueueSchedulerError[];
}> {
  const queueManagedScheduled = await prisma.content.findMany({
    where: {
      brandId,
      scheduledAt: { gte: now },
      status: { in: ['scheduled'] },
      publishingQueueItem: { isNot: null },
    },
    select: { id: true },
  });

  const errors: QueueSchedulerError[] = [];
  let cancelled = 0;
  for (const content of queueManagedScheduled) {
    const result = await schedulerService.cancelScheduledPost(content.id);
    if (!result.success) {
      errors.push({
        contentId: content.id,
        operation: 'cancel',
        error: result.error || 'cancel_failed',
      });
      continue;
    }
    cancelled += 1;
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

export async function loadSlots(brandId: string): Promise<any[]> {
  return prisma.publishingQueueSlot.findMany({
    where: {
      queue: {
        isDefault: true,
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
}

export async function loadQueueItems(brandId: string): Promise<QueueItemRow[]> {
  return prisma.publishingQueueItem.findMany({
    where: {
      queue: {
        socialAccount: { brandId },
      },
    },
    include: {
      queue: { select: { socialAccountId: true, isDefault: true } },
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
}

export async function pruneInactiveQueueItems(queueItems: QueueItemRow[]): Promise<QueueItemRow[]> {
  const pruneItemIds = queueItems
    .filter(
      (item) =>
        item.content &&
        (item.content.status === 'published' || item.content.status === 'unavailable')
    )
    .map((item) => item.id);

  if (pruneItemIds.length > 0) {
    await prisma.publishingQueueItem.deleteMany({ where: { id: { in: pruneItemIds } } });
  }

  const prunedIdSet = new Set(pruneItemIds);
  return queueItems.filter((item) => !prunedIdSet.has(item.id));
}

export async function loadReservedTimesByAccount(
  brandId: string,
  startAtUtc: Date
): Promise<Map<string, number[]>> {
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
  for (const reserved of reservedScheduled) {
    if (!reserved.targetSocialAccountId || !reserved.scheduledAt) {
      continue;
    }
    const list = reservedTimesByAccount.get(reserved.targetSocialAccountId) ?? [];
    list.push(reserved.scheduledAt.getTime());
    reservedTimesByAccount.set(reserved.targetSocialAccountId, list);
  }

  for (const [accountId, list] of reservedTimesByAccount.entries()) {
    list.sort((a, b) => a - b);
    reservedTimesByAccount.set(accountId, list);
  }

  return reservedTimesByAccount;
}

export function buildCandidateInstances(params: {
  slots: any[];
  timezone: string;
  startAtUtc: Date;
  slotScanLimitPerAccount: number;
  slotConflictWindowMs: number;
  reservedTimesByAccount: Map<string, number[]>;
}): GlobalSlotInstance[] {
  const slotsByAccount = groupSlotsByAccount(params.slots);
  const candidateInstances: GlobalSlotInstance[] = [];

  for (const [socialAccountId, accountSlots] of slotsByAccount.entries()) {
    const templates = accountSlots.map((slot) => ({
      slotId: slot.id,
      queueId: slot.queueId,
      laneKey: normalizeSlotLaneKey(slot.laneKey),
      dayOfWeek: slot.dayOfWeek,
      localTime: slot.localTime,
    }));
    const instances = generateSlotInstances({
      slots: templates,
      timezone: params.timezone,
      startAtUtc: params.startAtUtc,
      limit: params.slotScanLimitPerAccount,
    });
    addUnoccupiedInstances({
      socialAccountId,
      instances,
      reserved: params.reservedTimesByAccount.get(socialAccountId) ?? [],
      slotConflictWindowMs: params.slotConflictWindowMs,
      candidateInstances,
    });
  }

  candidateInstances.sort((a, b) => a.scheduledAtUtc.getTime() - b.scheduledAtUtc.getTime());
  return candidateInstances;
}
