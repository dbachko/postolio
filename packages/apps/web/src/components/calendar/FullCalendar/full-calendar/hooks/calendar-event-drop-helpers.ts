import { toast } from 'sonner';

import {
  content as contentApi,
  publishingQueues as publishingQueuesApi,
  type Content,
} from '@/lib/api';

import type { CalendarEvent } from '../../types';
import type {
  CalendarDropContext,
  EventDropArgs,
  LaneKey,
  ScheduleAheadLimits,
} from './calendar-event-drop-types';
import {
  adjustQueueDepth,
  removeQueueItemFromCalendarCache,
  setOptimistic,
  upsertCalendarCache,
} from './calendar-event-drop-cache';

function toRecord(value: unknown) {
  return value as Record<string, unknown>;
}

function getSourceQueueItemId(record: Record<string, unknown>) {
  const rawValue = (record as any).publishingQueueItemId;
  if (typeof rawValue !== 'string') {
    return null;
  }
  const trimmedValue = rawValue.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

export function getTargetSlotUtcIso(targetEvent?: CalendarEvent | null) {
  const scheduledAtValue =
    typeof targetEvent?.resource?.scheduledAt === 'string'
      ? targetEvent.resource.scheduledAt.trim()
      : '';
  return scheduledAtValue.length > 0 ? scheduledAtValue : null;
}

function getTargetLaneKey(targetEvent?: CalendarEvent | null): LaneKey {
  const laneKeyValue =
    typeof (targetEvent?.resource?.item as any)?.laneKey === 'string'
      ? (targetEvent?.resource?.item as any).laneKey
      : null;
  if (
    laneKeyValue === 'post' ||
    laneKeyValue === 'reel' ||
    laneKeyValue === 'story' ||
    laneKeyValue === 'any'
  ) {
    return laneKeyValue;
  }
  return 'post';
}

function getSourceLaneKey(record: Record<string, unknown>): LaneKey {
  const contentType = typeof record.contentType === 'string' ? record.contentType.trim() : '';
  if (contentType === 'reel') {
    return 'reel';
  }
  if (contentType === 'story') {
    return 'story';
  }
  return 'post';
}

function getMultiDestinationInfo(record: Record<string, unknown>) {
  const groupId =
    typeof record.contentGroupId === 'string' && record.contentGroupId.trim().length > 0
      ? record.contentGroupId.trim()
      : null;
  return {
    groupId,
    isMultiDestination: record.isMultiDestination === true && Boolean(groupId),
  };
}

export function isQueueSlotTarget(targetEvent?: CalendarEvent | null) {
  if (!targetEvent?.resource?.placeholder) {
    return false;
  }
  const record = targetEvent.resource.item as any;
  if (record?.message === 'Queue slot') {
    return true;
  }
  return typeof record?.id === 'string' && record.id.startsWith('queue-slot:');
}

function getScheduleAheadLimitMessage(scheduleAheadLimits?: ScheduleAheadLimits) {
  return `Scheduling limit reached (${scheduleAheadLimits?.currentCount}/${scheduleAheadLimits?.maxAllowed}). Upgrade to add more.`;
}

function resolveQueueSlotDrop({
  resource,
  targetEvent,
}: {
  resource: CalendarEvent['resource'];
  targetEvent: CalendarEvent;
}) {
  const targetSlotUtcIso = getTargetSlotUtcIso(targetEvent);
  if (!targetSlotUtcIso) {
    return { status: 'missing-target-slot' as const };
  }

  const record = toRecord(resource.item);
  const sourceLaneKey = getSourceLaneKey(record);
  const targetLaneKey = getTargetLaneKey(targetEvent);
  if (targetLaneKey !== 'any' && targetLaneKey !== sourceLaneKey) {
    return { status: 'incompatible-lane' as const };
  }

  return {
    status: 'ok' as const,
    record,
    sourceQueueItemId: getSourceQueueItemId(record),
    targetSlotUtcIso,
  };
}

async function scheduleIntoSlot({
  context,
  event,
  resource,
  targetSlotUtcIso,
}: {
  context: CalendarDropContext;
  event: CalendarEvent;
  resource: CalendarEvent['resource'];
  targetSlotUtcIso: string;
}) {
  setOptimistic({
    contentId: event.id,
    override: {
      ...(resource.item as any),
      status: 'scheduled',
      scheduledAt: targetSlotUtcIso,
      publishingQueueItemId: null,
    } as Content,
    action: 'rescheduling',
    optimisticClearTimersRef: context.optimisticClearTimersRef,
    setOptimisticByContentId: context.setOptimisticByContentId,
  });

  await contentApi.updateContent({ contentId: event.id, scheduledAt: targetSlotUtcIso });
  upsertCalendarCache({
    brandId: context.brandId,
    brandTimezone: context.brandTimezone,
    queryClient: context.queryClient,
    nextItem: {
      ...(resource.item as any),
      id: event.id,
      brandId: context.brandId,
      scheduledAt: targetSlotUtcIso,
      status: 'scheduled',
      publishingQueueItemId: null,
    } as Content,
  });
}

async function removeScheduledItemFromQueue({
  context,
  contentId,
  sourceQueueItemId,
}: {
  context: CalendarDropContext;
  contentId: string;
  sourceQueueItemId: string;
}) {
  try {
    await publishingQueuesApi.removeQueueItem(context.queueId!, sourceQueueItemId);
    adjustQueueDepth({
      queryClient: context.queryClient,
      effectiveSingleDestinationId: context.effectiveSingleDestinationId,
      delta: -1,
    });
    removeQueueItemFromCalendarCache({
      queryClient: context.queryClient,
      queueId: context.queueId!,
      viewKey: context.viewKey,
      queueItemId: sourceQueueItemId,
      contentId,
    });
  } catch (queueRemoveError) {
    console.error(queueRemoveError);
    toast.error('Scheduled, but failed to remove from queue. Refresh to resolve.');
  }
}

export async function handleQueueSlotDrop({
  context,
  event,
  resource,
  targetEvent,
}: {
  context: CalendarDropContext;
  event: CalendarEvent;
  resource: CalendarEvent['resource'];
  targetEvent: CalendarEvent;
}) {
  if (!context.queueId || !context.effectiveSingleDestinationId) {
    toast.error('Select a single destination to use queue slots.');
    return;
  }

  const resolvedDrop = resolveQueueSlotDrop({ resource, targetEvent });
  if (resolvedDrop.status === 'missing-target-slot') {
    toast.error('Missing target slot time.');
    return;
  }
  if (resolvedDrop.status === 'incompatible-lane') {
    return;
  }

  const { isMultiDestination } = getMultiDestinationInfo(resolvedDrop.record);
  if (isMultiDestination) {
    toast.error('Multi-destination posts cannot be moved into a queue slot yet.');
    return;
  }

  if (resolvedDrop.sourceQueueItemId && context.scheduleAheadAtCapacity) {
    toast.error(getScheduleAheadLimitMessage(context.scheduleAheadLimits));
    return;
  }

  await scheduleIntoSlot({
    context,
    event,
    resource,
    targetSlotUtcIso: resolvedDrop.targetSlotUtcIso,
  });

  if (resolvedDrop.sourceQueueItemId) {
    await removeScheduledItemFromQueue({
      context,
      contentId: event.id,
      sourceQueueItemId: resolvedDrop.sourceQueueItemId,
    });
  }
  toast.success('Post scheduled');
}

export async function handleExplicitSlotDrop({
  context,
  event,
  resource,
  targetSlotUtcIso,
}: {
  context: CalendarDropContext;
  event: CalendarEvent;
  resource: CalendarEvent['resource'];
  targetSlotUtcIso: string;
}) {
  const record = toRecord(resource.item);
  const sourceQueueItemId = getSourceQueueItemId(record);
  const { groupId, isMultiDestination } = getMultiDestinationInfo(record);

  if (
    sourceQueueItemId &&
    context.queueId &&
    context.effectiveSingleDestinationId &&
    context.scheduleAheadAtCapacity
  ) {
    toast.error(getScheduleAheadLimitMessage(context.scheduleAheadLimits));
    return;
  }

  if (isMultiDestination && groupId) {
    await contentApi.scheduleContentGroup(groupId, targetSlotUtcIso);
  } else {
    await contentApi.updateContent({ contentId: event.id, scheduledAt: targetSlotUtcIso });
  }

  if (!sourceQueueItemId || !context.queueId || !context.effectiveSingleDestinationId) {
    toast.success('Post rescheduled');
    return;
  }

  try {
    await publishingQueuesApi.removeQueueItem(context.queueId, sourceQueueItemId);
    adjustQueueDepth({
      queryClient: context.queryClient,
      effectiveSingleDestinationId: context.effectiveSingleDestinationId,
      delta: -1,
    });
  } catch (queueRemoveError) {
    console.error(queueRemoveError);
    toast.error('Rescheduled, but failed to remove from queue. Refresh to resolve.');
  }
  toast.success('Post rescheduled');
}

export function invalidateDropQueries(context: CalendarDropContext) {
  context.queryClient.invalidateQueries({ queryKey: ['calendar', context.brandId] });
  context.queryClient.invalidateQueries({ queryKey: ['publishing-queue-slot-instances-calendar'] });
  context.queryClient.invalidateQueries({ queryKey: ['publishing-queue-items-calendar'] });
  context.queryClient.invalidateQueries({ queryKey: ['publishing-queue-slot-instances'] });
  context.queryClient.invalidateQueries({ queryKey: ['publishing-queue-items'] });
  if (context.effectiveSingleDestinationId) {
    context.queryClient.invalidateQueries({
      queryKey: ['publishing-queues', context.effectiveSingleDestinationId],
    });
  }
}

export function clearOptimisticOnError({
  event,
  setOptimisticByContentId,
}: {
  event: EventDropArgs['event'];
  setOptimisticByContentId: CalendarDropContext['setOptimisticByContentId'];
}) {
  if (!event?.id) {
    return;
  }
  setOptimisticByContentId((previous) => {
    if (!(event.id in previous)) {
      return previous;
    }
    const next = { ...previous };
    delete next[event.id];
    return next;
  });
}
