import type { QueryClient } from '@tanstack/react-query';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import type { CalendarItem } from '@/types/calendar';
import type { PublishingQueueLaneKey } from '@/lib/api/publishing-queues-client';
import { CALENDAR_INVALIDATION_QUERY_KEYS, QUEUE_SLOT_PLACEHOLDER_MESSAGE } from './constants';
import type { GroupMeta, PostStatus, PrimaryAsset, QueueSlotMeta } from './types';

export const invalidateCalendarQueries = (queryClient: QueryClient) => {
  for (const queryKey of CALENDAR_INVALIDATION_QUERY_KEYS) {
    queryClient.invalidateQueries({ queryKey });
  }
};

export const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }
  return fallback;
};

export const getOptimisticLabel = (item: CalendarItem) => {
  const record = item as unknown as { optimisticAction?: unknown };
  const action = record.optimisticAction;
  if (action === 'queueing') {
    return 'Queueing…';
  }
  if (action === 'rescheduling') {
    return 'Rescheduling…';
  }
  return null;
};

export const getGroupMeta = (item: CalendarItem): GroupMeta | null => {
  if (item.type !== 'content') {
    return null;
  }

  const contentGroupId =
    typeof item.contentGroupId === 'string' && item.contentGroupId.trim().length > 0
      ? item.contentGroupId.trim()
      : null;
  const isMultiDestination = item.isMultiDestination === true && Boolean(contentGroupId);
  const destinationCount = Array.isArray(item.destinationContentIds)
    ? item.destinationContentIds.filter(Boolean).length
    : 0;

  if (!isMultiDestination || !contentGroupId) {
    return null;
  }

  return {
    contentGroupId,
    destinationCount: destinationCount > 0 ? destinationCount : 2,
  };
};

export const getStatusTimeInfo = (item: CalendarItem, timezone: string) => {
  const status: PostStatus = item.type === 'content' ? item.status : 'placeholder';

  const timestamp =
    (item.type === 'content' && item.status === 'published' ? item.postedAt : null) ||
    (item.type === 'content' ? item.scheduledAt : item.scheduledAt) ||
    (item.type === 'content' ? item.postedAt : null) ||
    null;

  const displayTime = timestamp ? formatInTimeZone(new Date(timestamp), timezone, 'h:mm a') : '';

  const statusLabel = (() => {
    switch (status) {
      case 'published':
        return 'Published';
      case 'scheduled':
        return 'Scheduled';
      case 'draft':
        return 'Draft';
      case 'failed':
        return 'Failed';
      case 'skipped':
        return 'Skipped';
      case 'placeholder':
        return 'Empty slot';
      default: {
        const raw = String(status || '');
        if (!raw) {
          return 'Status';
        }
        return raw.charAt(0).toUpperCase() + raw.slice(1);
      }
    }
  })();

  const statusTooltip = (() => {
    if (!timestamp) {
      return statusLabel;
    }
    try {
      return `${statusLabel} • ${formatInTimeZone(new Date(timestamp), timezone, 'MMM d, yyyy h:mm a')}`;
    } catch {
      return statusLabel;
    }
  })();

  return { status, displayTime, timestamp, statusTooltip };
};

export const getPreviewUrl = (primaryAsset?: PrimaryAsset | null) => {
  if (!primaryAsset) {
    return null;
  }
  if (primaryAsset.fileType === 'video') {
    return primaryAsset.thumbnailUrl || null;
  }
  return primaryAsset.thumbnailUrl || primaryAsset.url || null;
};

export const extractHashtags = (item: CalendarItem): string[] => {
  const record = item as unknown as Record<string, unknown>;
  const raw = record.hashtags;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean);
};

function parseTargetSocialAccountIds(record: Record<string, unknown>): string[] {
  if (Array.isArray(record.targetSocialAccountIds)) {
    return (record.targetSocialAccountIds as unknown[])
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter(Boolean);
  }

  if (typeof record.targetSocialAccountIds === 'string') {
    return record.targetSocialAccountIds
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }

  return [];
}

export const getPlaceholderCreateParams = (
  item: CalendarItem
): Record<string, string | null | undefined> => {
  if (item.type !== 'placeholder') {
    return {};
  }
  const record = item as unknown as Record<string, unknown>;
  const params: Record<string, string | null | undefined> = {};

  const scheduledAt = typeof item.scheduledAt === 'string' ? item.scheduledAt.trim() : '';
  if (scheduledAt) {
    params.scheduledAt = scheduledAt;
  }

  const targetSocialAccountId =
    typeof record.targetSocialAccountId === 'string' && record.targetSocialAccountId.trim()
      ? record.targetSocialAccountId.trim()
      : null;
  if (targetSocialAccountId) {
    params.targetSocialAccountId = targetSocialAccountId;
  }

  const targetSocialAccountIds = parseTargetSocialAccountIds(record);
  if (!targetSocialAccountId && targetSocialAccountIds.length > 0) {
    const unique = Array.from(new Set(targetSocialAccountIds));
    if (unique.length === 1) {
      params.targetSocialAccountId = unique[0];
    } else {
      params.targetSocialAccountIds = unique.join(',');
    }
  }

  const laneKey = typeof record.laneKey === 'string' ? record.laneKey : null;
  if (laneKey === 'post' || laneKey === 'reel' || laneKey === 'story') {
    params.contentType = laneKey;
  } else if (laneKey === 'any') {
    params.contentType = 'post';
  }

  return params;
};

export const isQueueSlotPlaceholder = (item: CalendarItem) =>
  item.type === 'placeholder' && item.message === QUEUE_SLOT_PLACEHOLDER_MESSAGE;

export const getQueueSlotMeta = (item: CalendarItem, timezone: string): QueueSlotMeta | null => {
  if (!isQueueSlotPlaceholder(item)) {
    return null;
  }

  const record = item as unknown as Record<string, unknown>;

  const scheduledAt =
    typeof item.scheduledAt === 'string' && item.scheduledAt.trim() ? item.scheduledAt : null;
  const laneKey = typeof record.laneKey === 'string' ? record.laneKey : null;
  const normalizedLaneKey: PublishingQueueLaneKey =
    laneKey === 'post' || laneKey === 'reel' || laneKey === 'story' || laneKey === 'any'
      ? (laneKey as PublishingQueueLaneKey)
      : 'post';

  const timeLabel = scheduledAt ? formatInTimeZone(new Date(scheduledAt), timezone, 'h:mm a') : '';
  const isPast = scheduledAt
    ? toZonedTime(new Date(scheduledAt), timezone).getTime() <
      toZonedTime(new Date(), timezone).getTime()
    : false;

  return {
    scheduledAt,
    laneKey: normalizedLaneKey,
    timeLabel,
    isPast,
  };
};
