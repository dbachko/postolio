import type { CalendarItem } from '@/types/calendar';
import type { QueueSlotMeta, ItemRecord } from '../types';
import type { PublishingQueueLaneKey } from '@/lib/api/publishing-queues-client';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { asRecord } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Queue Slot Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks if an item is a queue slot placeholder.
 */
export function isQueueSlotPlaceholder(item: CalendarItem): boolean {
  if (item.type !== 'placeholder') return false;
  const record = asRecord(item);
  return record.message === 'Queue slot';
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue Slot Metadata
// ─────────────────────────────────────────────────────────────────────────────

function getString(record: ItemRecord, key: string): string | null {
  const val = record[key];
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeLaneKey(laneKey: string | null): PublishingQueueLaneKey {
  if (laneKey === 'post' || laneKey === 'reel' || laneKey === 'story' || laneKey === 'any') {
    return laneKey;
  }
  return 'post';
}

/**
 * Extracts metadata for queue slot placeholders.
 * Returns null if the item is not a queue slot.
 */
export function extractQueueSlotMeta(item: CalendarItem, timezone: string): QueueSlotMeta | null {
  if (!isQueueSlotPlaceholder(item)) return null;

  const record = asRecord(item);
  const scheduledAt = getString(record, 'scheduledAt');
  const laneKey = getString(record, 'laneKey');
  const normalizedLaneKey = normalizeLaneKey(laneKey);

  let timeLabel = '';
  let isPast = false;

  if (scheduledAt) {
    try {
      timeLabel = formatInTimeZone(new Date(scheduledAt), timezone, 'h:mm a');
      const slotTime = toZonedTime(new Date(scheduledAt), timezone).getTime();
      const nowTime = toZonedTime(new Date(), timezone).getTime();
      isPast = slotTime < nowTime;
    } catch {
      // Invalid date, leave defaults
    }
  }

  return {
    scheduledAt,
    laneKey: normalizedLaneKey,
    timeLabel,
    isPast,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Placeholder Create Params
// ─────────────────────────────────────────────────────────────────────────────

export interface PlaceholderCreateParams {
  scheduledAt?: string;
  campaignId?: string;
  targetSocialAccountId?: string;
  targetSocialAccountIds?: string;
  contentType?: string;
  [key: string]: string | undefined; // Index signature for Record compatibility
}

/**
 * Extracts parameters for creating a post from a placeholder.
 */
export function extractPlaceholderParams(item: CalendarItem): PlaceholderCreateParams {
  const record = asRecord(item);
  const params: PlaceholderCreateParams = {};

  const scheduledAt = getString(record, 'scheduledAt');
  if (scheduledAt) params.scheduledAt = scheduledAt;

  const campaignId = getString(record, 'campaignId');
  if (campaignId && campaignId !== 'none') params.campaignId = campaignId;

  const targetSocialAccountId = getString(record, 'targetSocialAccountId');
  if (targetSocialAccountId) {
    params.targetSocialAccountId = targetSocialAccountId;
  }

  // Handle array or comma-separated string of account IDs
  const targetSocialAccountIdsRaw = getString(record, 'targetSocialAccountIds');
  const targetSocialAccountIds = Array.isArray(record.targetSocialAccountIds)
    ? (record.targetSocialAccountIds as unknown[])
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter(Boolean)
    : targetSocialAccountIdsRaw
      ? targetSocialAccountIdsRaw
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : [];

  if (!targetSocialAccountId && targetSocialAccountIds.length > 0) {
    const unique = Array.from(new Set(targetSocialAccountIds));
    if (unique.length === 1) {
      params.targetSocialAccountId = unique[0];
    } else {
      params.targetSocialAccountIds = unique.join(',');
    }
  }

  const laneKey = getString(record, 'laneKey');
  if (laneKey === 'post' || laneKey === 'reel' || laneKey === 'story') {
    params.contentType = laneKey;
  } else if (laneKey === 'any') {
    params.contentType = 'post';
  }

  return params;
}
