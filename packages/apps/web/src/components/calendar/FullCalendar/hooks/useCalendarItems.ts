import { useMemo } from 'react';
import type { Content } from '@/lib/api';
import type { CalendarContentItem } from '@/types/calendar';
import type { CalendarDataItem, PlaceholderItem } from '../types';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function getIsoMillis(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? null : ts;
}

function deriveGroupStatus(items: Content[]): Content['status'] {
  const statuses = items.map((item) => String((item as any)?.status || '')).filter(Boolean);
  if (statuses.some((s) => s === 'failed')) {
    return 'failed';
  }
  if (statuses.every((s) => s === 'published')) {
    return 'published';
  }
  if (statuses.some((s) => s === 'published')) {
    return 'published';
  }
  if (statuses.some((s) => s === 'scheduled')) {
    return 'scheduled';
  }
  if (statuses.some((s) => s === 'skipped')) {
    return 'skipped';
  }
  return 'draft';
}

function toIsoFromMillis(values: Array<number | null>, mode: 'min' | 'max'): string | null {
  const valid = values.filter((value): value is number => typeof value === 'number');
  if (!valid.length) {
    return null;
  }
  return new Date(mode === 'min' ? Math.min(...valid) : Math.max(...valid)).toISOString();
}

function collectDistinctContent(content: Content[] | undefined): Content[] {
  const seen = new Set<string>();
  return (content ?? []).filter((entry) => {
    if (!entry?.id || seen.has(entry.id)) {
      return false;
    }
    seen.add(entry.id);
    return true;
  });
}

function splitContentByGroup(content: Content[]): {
  singles: Content[];
  groups: Map<string, Content[]>;
} {
  const groups = new Map<string, Content[]>();
  const singles: Content[] = [];

  for (const entry of content) {
    const groupId = isNonEmptyString((entry as any).contentGroupId)
      ? String((entry as any).contentGroupId).trim()
      : null;
    if (!groupId) {
      singles.push(entry);
      continue;
    }
    const bucket = groups.get(groupId) ?? [];
    bucket.push(entry);
    groups.set(groupId, bucket);
  }
  return { singles, groups };
}

function toSingleContentItem(entry: Content): CalendarContentItem {
  return { ...entry, type: 'content' };
}

function getDestinationSocialAccountIds(items: Content[]): string[] {
  return items
    .map((item) => (item as any).targetSocialAccountId)
    .filter(isNonEmptyString)
    .map((id) => id.trim());
}

function getPublishingQueueItemId(items: Content[]): string | null {
  const candidate = items
    .map((item) => (item as any)?.publishingQueueItemId)
    .find((value) => isNonEmptyString(value));
  return candidate ? String(candidate).trim() : null;
}

function toGroupedContentItem(groupId: string, items: Content[]): CalendarContentItem {
  const sortedByCreatedAt = items
    .slice()
    .sort((a, b) => (getIsoMillis(a.createdAt) ?? 0) - (getIsoMillis(b.createdAt) ?? 0));
  const primary = sortedByCreatedAt[0]!;
  const scheduledAt = toIsoFromMillis(
    items.map((item) => getIsoMillis(item.scheduledAt)),
    'min'
  );
  const postedAt = toIsoFromMillis(
    items.map((item) => getIsoMillis(item.postedAt)),
    'max'
  );
  const createdAt =
    toIsoFromMillis(
      items.map((item) => getIsoMillis(item.createdAt)),
      'min'
    ) ?? primary.createdAt;
  const updatedAt =
    toIsoFromMillis(
      items.map((item) => getIsoMillis(item.updatedAt)),
      'max'
    ) ?? primary.updatedAt;

  return {
    ...primary,
    contentGroupId: groupId,
    status: deriveGroupStatus(items),
    scheduledAt,
    postedAt,
    createdAt,
    updatedAt,
    destinationSocialAccountIds: getDestinationSocialAccountIds(items),
    destinationContentIds: items.map((item) => item.id),
    isMultiDestination: true,
    publishingQueueItemId: getPublishingQueueItemId(items),
    type: 'content',
  };
}

function buildCalendarContentItems(
  content: Content[] | undefined,
  multiDestinationEnabled: boolean
): CalendarContentItem[] {
  const distinctContent = collectDistinctContent(content);
  const { singles, groups } = splitContentByGroup(distinctContent);
  const groupedContent = singles.map(toSingleContentItem);

  for (const [groupId, items] of groups.entries()) {
    if (items.length <= 1) {
      groupedContent.push(toSingleContentItem(items[0]!));
      continue;
    }

    if (!multiDestinationEnabled) {
      groupedContent.push(...items.map(toSingleContentItem));
      continue;
    }

    groupedContent.push(toGroupedContentItem(groupId, items));
  }

  return groupedContent;
}

function buildPlaceholderItems(placeholders: PlaceholderItem[] | undefined): CalendarDataItem[] {
  return (placeholders ?? []).map((entry) => ({ ...entry, type: 'placeholder' as const }));
}

export function useCalendarItems(
  content: Content[] | undefined,
  placeholders: PlaceholderItem[] | undefined,
  multiDestinationEnabled = true
): CalendarDataItem[] {
  return useMemo(() => {
    const groupedContent = buildCalendarContentItems(content, multiDestinationEnabled);
    const placeholderItems = buildPlaceholderItems(placeholders);
    return [...groupedContent, ...placeholderItems];
  }, [content, multiDestinationEnabled, placeholders]);
}
