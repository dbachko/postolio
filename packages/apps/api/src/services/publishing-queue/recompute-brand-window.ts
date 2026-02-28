import { TimezoneService } from '../timezone.js';
import { schedulerService } from '../scheduler.js';
import {
  buildCandidateInstances,
  cancelQueueManagedScheduledContent,
  loadBrand,
  loadQueueItems,
  loadReservedTimesByAccount,
  loadSlots,
  pruneInactiveQueueItems,
  resolveWindowSize,
  type GlobalSlotInstance,
  type QueueItemRow,
} from './recompute-brand-window-data.js';
import type { LaneKey } from './slot-instance-generator.js';

type ContentLaneKey = Exclude<LaneKey, 'any'>;
const CONTENT_LANES: ContentLaneKey[] = ['post', 'reel', 'story'];

export interface QueueSchedulerError {
  contentId: string;
  operation: string;
  error: string;
}

export interface RecomputeBrandWindowResult {
  success: boolean;
  windowSize: number;
  assigned: number;
  scheduled: number;
  rescheduled: number;
  cancelled: number;
  errors: QueueSchedulerError[];
}

export interface RecomputeBrandWindowConfig {
  schedulingBufferMs: number;
  maxWindowSize: number;
  slotScanLimitPerAccount: number;
  slotConflictWindowMs: number;
}

function normalizeContentLaneKey(value: unknown): ContentLaneKey {
  if (value === 'reel' || value === 'story') {
    return value;
  }
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

function queueLaneKeyOf(queueId: string, laneKey: LaneKey): string {
  return `${queueId}:${laneKey}`;
}

function createBrandNotFoundResult(brandId: string): RecomputeBrandWindowResult {
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

function buildQueueLaneState(
  activeQueueItems: QueueItemRow[],
  brandId: string
): {
  itemsByQueueLane: Map<string, QueueItemRow[]>;
  itemIndexByQueueLane: Map<string, number>;
} {
  const itemsByQueueLane = new Map<string, QueueItemRow[]>();
  const itemIndexByQueueLane = new Map<string, number>();

  for (const item of activeQueueItems) {
    if (!isEligibleQueueItem(item, brandId)) {
      continue;
    }
    const laneKey = normalizeContentLaneKey(item.content.contentType ?? item.laneKey);
    const key = queueLaneKeyOf(item.queueId, laneKey);
    const list = itemsByQueueLane.get(key) ?? [];
    list.push(item);
    itemsByQueueLane.set(key, list);
    if (!itemIndexByQueueLane.has(key)) {
      itemIndexByQueueLane.set(key, 0);
    }
  }

  for (const [key, list] of itemsByQueueLane.entries()) {
    list.sort((a, b) => a.position - b.position);
    itemsByQueueLane.set(key, list);
  }

  return { itemsByQueueLane, itemIndexByQueueLane };
}

function isEligibleQueueItem(item: QueueItemRow, brandId: string): boolean {
  const content = item.content;
  if (content?.brandId !== brandId || !item.queue.socialAccountId) {
    return false;
  }
  if (!item.queue.isDefault || content.targetSocialAccountId !== item.queue.socialAccountId) {
    return false;
  }
  return !isSkippableContentStatus(content.status);
}

function peekNextEligibleItem(params: {
  queueId: string;
  laneKey: ContentLaneKey;
  scheduledAtUtc: Date;
  itemsByQueueLane: Map<string, QueueItemRow[]>;
  itemIndexByQueueLane: Map<string, number>;
}): { item: QueueItemRow; index: number } | null {
  const key = queueLaneKeyOf(params.queueId, params.laneKey);
  const list = params.itemsByQueueLane.get(key);
  if (!list || list.length === 0) {
    return null;
  }

  let index = params.itemIndexByQueueLane.get(key) ?? 0;
  while (index < list.length) {
    const item = list[index];
    const content = item?.content;
    if (!content || isSkippableContentStatus(content.status)) {
      index += 1;
      continue;
    }
    if (item.notBefore && params.scheduledAtUtc.getTime() < item.notBefore.getTime()) {
      params.itemIndexByQueueLane.set(key, index);
      return null;
    }
    params.itemIndexByQueueLane.set(key, index);
    return { item, index };
  }

  params.itemIndexByQueueLane.set(key, index);
  return null;
}

function chooseLaneForAnySlot(params: {
  queueId: string;
  scheduledAtUtc: Date;
  itemsByQueueLane: Map<string, QueueItemRow[]>;
  itemIndexByQueueLane: Map<string, number>;
}): { lane: ContentLaneKey; item: QueueItemRow; index: number } | null {
  const candidates = CONTENT_LANES.map((lane) => ({
    lane,
    peek: peekNextEligibleItem({
      queueId: params.queueId,
      laneKey: lane,
      scheduledAtUtc: params.scheduledAtUtc,
      itemsByQueueLane: params.itemsByQueueLane,
      itemIndexByQueueLane: params.itemIndexByQueueLane,
    }),
  })).filter(
    (
      candidate
    ): candidate is { lane: ContentLaneKey; peek: { item: QueueItemRow; index: number } } =>
      Boolean(candidate.peek)
  );

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    const leftMs = left.peek.item.createdAt.getTime();
    const rightMs = right.peek.item.createdAt.getTime();
    if (leftMs !== rightMs) {
      return leftMs - rightMs;
    }
    return left.peek.item.contentId.localeCompare(right.peek.item.contentId);
  });

  const chosen = candidates[0]!;
  return { lane: chosen.lane, item: chosen.peek.item, index: chosen.peek.index };
}

function buildDesiredSchedule(params: {
  candidateInstances: GlobalSlotInstance[];
  activeQueueItems: QueueItemRow[];
  brandId: string;
  windowSize: number;
}): Map<string, Date> {
  const desiredSchedule = new Map<string, Date>();
  const state = buildQueueLaneState(params.activeQueueItems, params.brandId);

  for (const instance of params.candidateInstances) {
    if (desiredSchedule.size >= params.windowSize) {
      break;
    }

    if (instance.laneKey === 'any') {
      assignAnyLaneInstance({ instance, desiredSchedule, ...state });
      continue;
    }

    assignSpecificLaneInstance({
      instance,
      desiredSchedule,
      itemsByQueueLane: state.itemsByQueueLane,
      itemIndexByQueueLane: state.itemIndexByQueueLane,
    });
  }

  return desiredSchedule;
}

function assignAnyLaneInstance(params: {
  instance: GlobalSlotInstance;
  desiredSchedule: Map<string, Date>;
  itemsByQueueLane: Map<string, QueueItemRow[]>;
  itemIndexByQueueLane: Map<string, number>;
}): void {
  const chosen = chooseLaneForAnySlot({
    queueId: params.instance.queueId,
    scheduledAtUtc: params.instance.scheduledAtUtc,
    itemsByQueueLane: params.itemsByQueueLane,
    itemIndexByQueueLane: params.itemIndexByQueueLane,
  });
  if (!chosen?.item.content) {
    return;
  }
  params.desiredSchedule.set(chosen.item.content.id, params.instance.scheduledAtUtc);
  const key = queueLaneKeyOf(params.instance.queueId, chosen.lane);
  params.itemIndexByQueueLane.set(key, chosen.index + 1);
}

function assignSpecificLaneInstance(params: {
  instance: GlobalSlotInstance;
  desiredSchedule: Map<string, Date>;
  itemsByQueueLane: Map<string, QueueItemRow[]>;
  itemIndexByQueueLane: Map<string, number>;
}): void {
  const laneKey = params.instance.laneKey as ContentLaneKey;
  const peek = peekNextEligibleItem({
    queueId: params.instance.queueId,
    laneKey,
    scheduledAtUtc: params.instance.scheduledAtUtc,
    itemsByQueueLane: params.itemsByQueueLane,
    itemIndexByQueueLane: params.itemIndexByQueueLane,
  });
  if (!peek?.item.content) {
    return;
  }
  params.desiredSchedule.set(peek.item.content.id, params.instance.scheduledAtUtc);
  const key = queueLaneKeyOf(params.instance.queueId, laneKey);
  params.itemIndexByQueueLane.set(key, peek.index + 1);
}

function buildOperations(params: {
  activeQueueItems: QueueItemRow[];
  desiredSchedule: Map<string, Date>;
  brandId: string;
}): {
  toCancel: string[];
  toReschedule: Array<{ contentId: string; scheduledAt: Date }>;
  toSchedule: Array<{ contentId: string; scheduledAt: Date }>;
} {
  const toCancel: string[] = [];
  const toReschedule: Array<{ contentId: string; scheduledAt: Date }> = [];
  const toSchedule: Array<{ contentId: string; scheduledAt: Date }> = [];

  for (const item of params.activeQueueItems) {
    if (!item.content || !item.queue.socialAccountId || item.content.brandId !== params.brandId) {
      continue;
    }
    if (item.content.targetSocialAccountId !== item.queue.socialAccountId) {
      continue;
    }

    const desired = params.desiredSchedule.get(item.content.id) ?? null;
    const isScheduled = item.content.status === 'scheduled' && Boolean(item.content.scheduledAt);

    if (!item.queue.isDefault) {
      if (isScheduled) {
        toCancel.push(item.content.id);
      }
      continue;
    }
    if (!desired) {
      if (isScheduled) {
        toCancel.push(item.content.id);
      }
      continue;
    }

    if (isScheduled) {
      if (item.content.scheduledAt!.getTime() !== desired.getTime()) {
        toReschedule.push({ contentId: item.content.id, scheduledAt: desired });
      }
      continue;
    }

    toSchedule.push({ contentId: item.content.id, scheduledAt: desired });
  }

  return { toCancel, toReschedule, toSchedule };
}

async function executeOperations(ops: {
  toCancel: string[];
  toReschedule: Array<{ contentId: string; scheduledAt: Date }>;
  toSchedule: Array<{ contentId: string; scheduledAt: Date }>;
}): Promise<{
  scheduled: number;
  rescheduled: number;
  cancelled: number;
  errors: QueueSchedulerError[];
}> {
  const errors: QueueSchedulerError[] = [];
  const cancelled = await runCancelOperations(ops.toCancel, errors);
  const rescheduled = await runRescheduleOperations(ops.toReschedule, errors);
  const scheduled = await runScheduleOperations(ops.toSchedule, errors);
  return { scheduled, rescheduled, cancelled, errors };
}

async function runCancelOperations(
  contentIds: string[],
  errors: QueueSchedulerError[]
): Promise<number> {
  let cancelled = 0;
  for (const contentId of contentIds) {
    const result = await schedulerService.cancelScheduledPost(contentId);
    if (!result.success) {
      errors.push({ contentId, operation: 'cancel', error: result.error || 'cancel_failed' });
      continue;
    }
    cancelled += 1;
  }
  return cancelled;
}

async function runRescheduleOperations(
  operations: Array<{ contentId: string; scheduledAt: Date }>,
  errors: QueueSchedulerError[]
): Promise<number> {
  let rescheduled = 0;
  for (const operation of operations) {
    const result = await schedulerService.reschedulePost(
      operation.contentId,
      operation.scheduledAt
    );
    if (!result.success) {
      errors.push({
        contentId: operation.contentId,
        operation: 'reschedule',
        error: result.error || 'reschedule_failed',
      });
      continue;
    }
    rescheduled += 1;
  }
  return rescheduled;
}

async function runScheduleOperations(
  operations: Array<{ contentId: string; scheduledAt: Date }>,
  errors: QueueSchedulerError[]
): Promise<number> {
  let scheduled = 0;
  for (const operation of operations) {
    const result = await schedulerService.scheduleContent(
      operation.contentId,
      operation.scheduledAt
    );
    if (!result.success) {
      errors.push({
        contentId: operation.contentId,
        operation: 'schedule',
        error: result.error || 'schedule_failed',
      });
      continue;
    }
    scheduled += 1;
  }
  return scheduled;
}

export async function recomputeBrandWindow(
  brandId: string,
  config: RecomputeBrandWindowConfig
): Promise<RecomputeBrandWindowResult> {
  const now = new Date();
  const startAtUtc = new Date(now.getTime() + config.schedulingBufferMs);

  const brand = await loadBrand(brandId);
  if (!brand) {
    return createBrandNotFoundResult(brandId);
  }

  const windowSize = await resolveWindowSize({
    brandId,
    now,
    tier: brand.user?.subscriptionTier || 'free',
    maxWindowSize: config.maxWindowSize,
  });
  if (windowSize <= 0) {
    return cancelQueueManagedScheduledContent(brandId, now, windowSize);
  }

  const timezone = await TimezoneService.getBrandTimezone(brandId);
  const [slots, queueItems, reservedTimesByAccount] = await Promise.all([
    loadSlots(brandId),
    loadQueueItems(brandId),
    loadReservedTimesByAccount(brandId, startAtUtc),
  ]);
  const activeQueueItems = await pruneInactiveQueueItems(queueItems);

  const candidateInstances = buildCandidateInstances({
    slots,
    timezone,
    startAtUtc,
    slotScanLimitPerAccount: config.slotScanLimitPerAccount,
    slotConflictWindowMs: config.slotConflictWindowMs,
    reservedTimesByAccount,
  });
  const desiredSchedule = buildDesiredSchedule({
    candidateInstances,
    activeQueueItems,
    brandId,
    windowSize,
  });
  const operations = buildOperations({ activeQueueItems, desiredSchedule, brandId });
  const execution = await executeOperations(operations);

  return {
    success: execution.errors.length === 0,
    windowSize,
    assigned: desiredSchedule.size,
    scheduled: execution.scheduled,
    rescheduled: execution.rescheduled,
    cancelled: execution.cancelled,
    errors: execution.errors,
  };
}
