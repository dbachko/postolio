import { useMemo } from 'react';
import type { Content } from '@/lib/api';
import type { CalendarDataItem, PlaceholderItem } from '../types';

export function useCalendarItems(
  content: Content[] | undefined,
  placeholders: PlaceholderItem[] | undefined
): CalendarDataItem[] {
  return useMemo(() => {
    const seen = new Set<string>();

    const sanitizedContent = (content ?? []).filter((entry) => {
      if (!entry?.id) return false;
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });

    const contentItems = sanitizedContent.map((entry) => ({ ...entry, type: 'content' as const }));
    const placeholderItems = (placeholders ?? []).map((entry) => ({
      ...entry,
      type: 'placeholder' as const,
    }));

    return [...contentItems, ...placeholderItems];
  }, [content, placeholders]);
}
