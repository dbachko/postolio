import type { CalendarItem } from '@/types/calendar';
import type { PostMeta, PostStatus, GroupMeta, ItemRecord } from '../types';
import { asRecord } from '../types';
import { STATUS_LABELS, OPTIMISTIC_LABELS } from '../constants';
import { formatDisplayTime, formatFullDateTime } from './format-time';

// ─────────────────────────────────────────────────────────────────────────────
// Post Metadata Extraction
// ─────────────────────────────────────────────────────────────────────────────

function getString(record: ItemRecord, key: string): string | null {
  const val = record[key];
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getStringArray(record: ItemRecord, key: string): string[] {
  const val = record[key];
  if (!Array.isArray(val)) return [];
  return val
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * Extracts normalized post metadata from a CalendarItem.
 * Handles both content items and placeholders.
 */
export function extractPostMeta(item: CalendarItem, timezone: string): PostMeta {
  const isPlaceholder = item.type === 'placeholder';
  const record = asRecord(item);

  // Derive status
  const rawStatus = getString(record, 'status');
  const status: PostStatus = rawStatus
    ? (rawStatus as PostStatus)
    : isPlaceholder
      ? 'placeholder'
      : 'draft';

  // Determine timestamp: prefer postedAt for published, otherwise scheduledAt
  const timestamp =
    (status === 'published' && getString(record, 'postedAt')) ||
    getString(record, 'scheduledAt') ||
    getString(record, 'postedAt');

  const displayTime = formatDisplayTime(timestamp, timezone);

  return {
    id: item.id,
    status,
    displayTime,
    timestamp,
    campaignId: getString(record, 'campaignId'),
    caption: getString(record, 'caption'),
    hashtags: getStringArray(record, 'hashtags'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Group Metadata (Multi-destination posts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts group metadata for multi-destination posts.
 * Returns null for single-destination posts or placeholders.
 */
export function extractGroupMeta(item: CalendarItem): GroupMeta | null {
  if (item.type === 'placeholder') return null;

  const record = asRecord(item);
  const contentGroupId = getString(record, 'contentGroupId');
  const isMultiDestination = record.isMultiDestination === true && Boolean(contentGroupId);

  if (!isMultiDestination || !contentGroupId) return null;

  const destinationContentIds = getStringArray(record, 'destinationContentIds');
  const destinationCount = destinationContentIds.length > 0 ? destinationContentIds.length : 2;

  return { contentGroupId, destinationCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// Status Tooltip
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a tooltip string for the post status.
 */
export function buildStatusTooltip(
  status: PostStatus,
  timestamp: string | null,
  timezone: string
): string {
  const statusLabel =
    STATUS_LABELS[status] ?? (status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Status');

  if (!timestamp) return statusLabel;

  const formattedDate = formatFullDateTime(timestamp, timezone);
  return formattedDate ? `${statusLabel} • ${formattedDate}` : statusLabel;
}

// ─────────────────────────────────────────────────────────────────────────────
// Optimistic Label
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gets the optimistic action label if the item is being updated.
 */
export function getOptimisticLabel(item: CalendarItem): string | null {
  const record = asRecord(item);
  const action = getString(record, 'optimisticAction');
  return action ? (OPTIMISTIC_LABELS[action] ?? null) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Preview URL
// ─────────────────────────────────────────────────────────────────────────────

interface AssetLike {
  fileType?: string | null;
  thumbnailUrl?: string | null;
  url?: string | null;
}

/**
 * Gets the preview URL for a media asset.
 * Videos use thumbnailUrl, images fall back to url.
 */
export function getPreviewUrl(asset: AssetLike | null | undefined): string | null {
  if (!asset) return null;
  if (asset.fileType === 'video') {
    return asset.thumbnailUrl || null;
  }
  return asset.thumbnailUrl || asset.url || null;
}
