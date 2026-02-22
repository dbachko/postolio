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

export function useCalendarItems(
  content: Content[] | undefined,
  placeholders: PlaceholderItem[] | undefined,
  multiDestinationEnabled = true
): CalendarDataItem[] {
  return useMemo(() => {
    const seen = new Set<string>();

    const sanitizedContent = (content ?? []).filter((entry) => {
      if (!entry?.id) {
        return false;
      }
      if (seen.has(entry.id)) {
        return false;
      }
      seen.add(entry.id);
      return true;
    });

    const groupBuckets = new Map<string, Content[]>();
    const singles: Content[] = [];

    for (const entry of sanitizedContent) {
      const groupId = isNonEmptyString((entry as any).contentGroupId)
        ? String((entry as any).contentGroupId).trim()
        : null;
      if (groupId) {
        const bucket = groupBuckets.get(groupId) ?? [];
        bucket.push(entry);
        groupBuckets.set(groupId, bucket);
      } else {
        singles.push(entry);
      }
    }

    const groupedContent: CalendarContentItem[] = singles.map((entry) => ({
      ...entry,
      type: 'content',
    }));
    for (const [groupId, items] of groupBuckets.entries()) {
      if (items.length <= 1) {
        groupedContent.push({ ...items[0]!, type: 'content' });
        continue;
      }

      if (!multiDestinationEnabled) {
        for (const item of items) {
          groupedContent.push({ ...item, type: 'content' });
        }
        continue;
      }

      const sortedByCreatedAt = items
        .slice()
        .sort((a, b) => (getIsoMillis(a.createdAt) ?? 0) - (getIsoMillis(b.createdAt) ?? 0));
      const primary = sortedByCreatedAt[0]!;

      const destinationSocialAccountIds = items
        .map((c) => (c as any).targetSocialAccountId)
        .filter(isNonEmptyString)
        .map((id) => id.trim());

      const scheduledAt = (() => {
        const times = items
          .map((c) => getIsoMillis(c.scheduledAt))
          .filter((v): v is number => typeof v === 'number');
        if (!times.length) {
          return null;
        }
        return new Date(Math.min(...times)).toISOString();
      })();

      const publishingQueueItemId = (() => {
        const candidate = items
          .map((c) => (c as any)?.publishingQueueItemId)
          .find((value) => isNonEmptyString(value));
        return candidate ? String(candidate).trim() : null;
      })();

      const postedAt = (() => {
        const times = items
          .map((c) => getIsoMillis(c.postedAt))
          .filter((v): v is number => typeof v === 'number');
        if (!times.length) {
          return null;
        }
        return new Date(Math.max(...times)).toISOString();
      })();

      const createdAt = (() => {
        const times = items
          .map((c) => getIsoMillis(c.createdAt))
          .filter((v): v is number => typeof v === 'number');
        if (!times.length) {
          return primary.createdAt;
        }
        return new Date(Math.min(...times)).toISOString();
      })();

      const updatedAt = (() => {
        const times = items
          .map((c) => getIsoMillis(c.updatedAt))
          .filter((v): v is number => typeof v === 'number');
        if (!times.length) {
          return primary.updatedAt;
        }
        return new Date(Math.max(...times)).toISOString();
      })();

      groupedContent.push({
        ...primary,
        contentGroupId: groupId,
        status: deriveGroupStatus(items),
        scheduledAt,
        postedAt,
        createdAt,
        updatedAt,
        destinationSocialAccountIds,
        destinationContentIds: items.map((c) => c.id),
        isMultiDestination: true,
        publishingQueueItemId,
        type: 'content',
      });
    }

    const placeholderItems = (placeholders ?? []).map((entry) => ({
      ...entry,
      type: 'placeholder' as const,
    }));

    return [...groupedContent, ...placeholderItems];
  }, [content, multiDestinationEnabled, placeholders]);
}
