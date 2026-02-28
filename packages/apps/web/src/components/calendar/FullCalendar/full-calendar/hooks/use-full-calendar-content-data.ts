import { useEffect, useMemo, useRef, useState } from 'react';
import type { Content } from '@/lib/api';
import { useAssetsByIds } from '@/features/assets/hooks/useAssetsByIds';
import { useCalendarItems } from '../../hooks/useCalendarItems';
import { useFilteredEvents } from '../../hooks/useFilteredEvents';
import { useCalendarFilters } from '../../hooks/useCalendarFilters';
import type { PlaceholderItem } from '../../types';
import { useCalendarQueueData } from './use-calendar-queue-data';
import { useOptimisticCalendarSync } from './use-optimistic-calendar-sync';
import type { OptimisticCalendarOp } from './use-calendar-event-drop';

interface UseFullCalendarContentDataParams {
  brandId: string;
  brandTimezone: string;
  view: 'month' | 'week';
  date: Date;
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  content: Content[];
  placeholders: PlaceholderItem[];
  multiDestinationEnabled: boolean;
  effectiveSingleDestinationId: string | null;
  timezone: string;
}

function resolveCandidateAssetId(
  primary: string | null | undefined,
  firstMedia: string | null | undefined
): string | null {
  if (typeof primary === 'string' && primary.trim().length > 0) {
    return primary;
  }
  if (typeof firstMedia === 'string' && firstMedia.trim().length > 0) {
    return firstMedia;
  }
  return null;
}

function collectPrimaryAssetIds(content: Content[]) {
  const ids = new Set<string>();
  for (const item of content) {
    const primary = item?.primaryAssetId;
    const firstMedia = item?.mediaAssets?.[0]?.assetId;
    const candidate = resolveCandidateAssetId(primary, firstMedia);
    if (candidate) {
      ids.add(candidate);
    }
  }
  return Array.from(ids);
}

export function useFullCalendarContentData({
  brandId,
  brandTimezone,
  view,
  date,
  weekStartsOn,
  content,
  placeholders,
  multiDestinationEnabled,
  effectiveSingleDestinationId,
  timezone,
}: UseFullCalendarContentDataParams) {
  const [optimisticByContentId, setOptimisticByContentId] = useState<
    Record<string, OptimisticCalendarOp>
  >({});
  const optimisticClearTimersRef = useRef<Record<string, number>>({});
  const { queueId, queueItems, queueEstimatedContent, queueSlotPlaceholders } =
    useCalendarQueueData({
      brandId,
      brandTimezone,
      view,
      date,
      weekStartsOn,
      content,
      effectiveSingleDestinationId,
      optimisticByContentId,
    });

  useOptimisticCalendarSync({ content, queueItems, setOptimisticByContentId });

  useEffect(() => {
    return () => {
      const timers = optimisticClearTimersRef.current;
      for (const id of Object.keys(timers)) {
        window.clearTimeout(timers[id]);
      }
      optimisticClearTimersRef.current = {};
    };
  }, []);

  const mergedPlaceholders = useMemo(() => {
    if (!effectiveSingleDestinationId) {
      return placeholders;
    }
    return [...placeholders, ...queueSlotPlaceholders];
  }, [effectiveSingleDestinationId, placeholders, queueSlotPlaceholders]);
  const mergedContent = useMemo(() => {
    const optimisticOverrides = Object.values(optimisticByContentId).map((op) => ({
      ...op.override,
      optimisticAction: op.action,
    }));
    if (!effectiveSingleDestinationId) {
      return [...optimisticOverrides, ...content];
    }
    return [...optimisticOverrides, ...content, ...queueEstimatedContent];
  }, [content, effectiveSingleDestinationId, optimisticByContentId, queueEstimatedContent]);

  const items = useCalendarItems(mergedContent, mergedPlaceholders, multiDestinationEnabled);
  const filters = useCalendarFilters();
  const events = useFilteredEvents(items, filters, timezone);
  const primaryAssetIds = useMemo(() => collectPrimaryAssetIds(mergedContent), [mergedContent]);
  const { data: assetsById } = useAssetsByIds(primaryAssetIds);

  return {
    assetsById,
    events,
    queueId,
    optimisticClearTimersRef,
    setOptimisticByContentId,
  };
}
