import { formatInTimeZone } from 'date-fns-tz';
import type { Content } from '@/lib/api';
import type {
  PublishingQueueItem,
  PublishingQueueSlotInstance,
} from '@/lib/api/publishing-queues-client';
import { getDisplayTitle, normalizeLaneKeyForContent } from './utils';

export function groupInstancesByDay(
  instances: PublishingQueueSlotInstance[],
  brandTimezone: string
) {
  const byDay = new Map<string, PublishingQueueSlotInstance[]>();
  for (const instance of instances) {
    const dayKey = formatInTimeZone(new Date(instance.scheduledAt), brandTimezone, 'yyyy-MM-dd');
    if (!byDay.has(dayKey)) {
      byDay.set(dayKey, []);
    }
    byDay.get(dayKey)!.push(instance);
  }
  return Array.from(byDay.entries()).sort((left, right) => left[0].localeCompare(right[0]));
}

export function getScheduleLimitMessage(scheduleAheadLimits?: {
  tier: string;
  maxAllowed: number;
  currentCount: number;
}) {
  if (!scheduleAheadLimits) {
    return 'Scheduling limit reached. Upgrade to add more.';
  }
  return `Scheduling limit reached (${scheduleAheadLimits.currentCount}/${scheduleAheadLimits.maxAllowed}). Upgrade to add more.`;
}

function resolveOccupiedContent(
  inst: PublishingQueueSlotInstance,
  calendarContentById: Map<string, Content>
): Content | null {
  if (!(inst.occupied && inst.occupiedContentId)) {
    return null;
  }
  return calendarContentById.get(inst.occupiedContentId) ?? null;
}

function resolveShowContentId(
  occupiedContent: Content | null,
  estimatedItem: PublishingQueueItem | null
): string | null {
  return occupiedContent?.id || estimatedItem?.contentId || null;
}

function resolveSlotTitle(params: {
  showContentId: string | null;
  occupiedContent: Content | null;
  estimatedItem: PublishingQueueItem | null;
}): string | null {
  if (!params.showContentId) {
    return null;
  }
  return getDisplayTitle({
    caption: params.occupiedContent?.caption || params.estimatedItem?.content?.caption || null,
    contentType:
      params.occupiedContent?.contentType || params.estimatedItem?.content?.contentType || null,
    laneKey: params.estimatedItem?.laneKey ?? normalizeLaneKeyForContent(params.occupiedContent),
  });
}

function resolveSlotPrimaryAssetId(params: {
  contentForThumb: Content | null;
  estimatedItem: PublishingQueueItem | null;
}): string | null {
  return (
    params.contentForThumb?.primaryAssetId ||
    params.contentForThumb?.mediaAssets?.[0]?.assetId ||
    params.estimatedItem?.content?.primaryAssetId ||
    params.estimatedItem?.content?.mediaAssets?.[0]?.assetId ||
    null
  );
}

function resolvePreviewUrl(
  primaryAsset: {
    fileType?: string | null;
    thumbnailUrl?: string | null;
    url?: string | null;
  } | null
): string | null {
  if (!primaryAsset) {
    return null;
  }
  if (primaryAsset.fileType === 'video') {
    return primaryAsset.thumbnailUrl || null;
  }
  return primaryAsset.thumbnailUrl || primaryAsset.url || null;
}

export function buildSlotRowModel(params: {
  inst: PublishingQueueSlotInstance;
  laneView: 'all' | 'post' | 'reel' | 'story';
  itemsByEstimatedMs: Map<number, PublishingQueueItem>;
  calendarContentById: Map<string, Content>;
  assetsById?: Record<
    string,
    { fileType?: string | null; thumbnailUrl?: string | null; url?: string | null } | null
  >;
  brandTimezone: string;
  nowUtcMs: number;
}) {
  const slotMs = new Date(params.inst.scheduledAt).getTime();
  const isPast = slotMs < params.nowUtcMs;
  const estimatedItem = params.itemsByEstimatedMs.get(slotMs) ?? null;
  const occupiedContent = resolveOccupiedContent(params.inst, params.calendarContentById);
  const showContentId = resolveShowContentId(occupiedContent, estimatedItem);
  const title = resolveSlotTitle({ showContentId, occupiedContent, estimatedItem });
  const contentForThumb = showContentId
    ? (params.calendarContentById.get(showContentId) ?? null)
    : null;
  const primaryAssetId = resolveSlotPrimaryAssetId({ contentForThumb, estimatedItem });
  const primaryAsset = primaryAssetId ? (params.assetsById?.[primaryAssetId] ?? null) : null;
  const previewUrl = resolvePreviewUrl(primaryAsset);
  const timeLabel = formatInTimeZone(
    new Date(params.inst.scheduledAt),
    params.brandTimezone,
    'h:mm a'
  );

  return { estimatedItem, isPast, occupiedContent, previewUrl, showContentId, timeLabel, title };
}
