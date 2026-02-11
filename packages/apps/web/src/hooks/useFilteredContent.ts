import { useMemo } from 'react';
import { useCalendarFilterStore, type CalendarFilterState } from '../stores/calendarFilterStore';
import { useShallow } from 'zustand/react/shallow';

interface ContentItem {
  id: string;
  type: 'content' | 'placeholder';
  caption: string;
  status: string;
  scheduledAt?: string | null;
  hashtags: string[];
  createdAt?: string;
  postedAt?: string | null;
  brandId: string;
  imageUrl?: string;
}

export function useFilteredContent(items: ContentItem[]) {
  const selectFilters = useShallow((s: CalendarFilterState) => ({
    statuses: s.statuses,
    searchQuery: s.searchQuery,
  }));
  const { statuses, searchQuery } = useCalendarFilterStore(selectFilters);

  const filteredItems = useMemo(() => {
    let filtered = [...items];

    // Filter by status
    if (statuses.length > 0) {
      filtered = filtered.filter(
        (item) =>
          item.status &&
          statuses.includes(
            item.status as 'draft' | 'scheduled' | 'published' | 'failed' | 'skipped'
          )
      );
    }

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((item) => {
        const caption = (item.caption || '').toLowerCase();
        const hashtags = (item.hashtags || []).join(' ').toLowerCase();

        return caption.includes(query) || hashtags.includes(query);
      });
    }

    return filtered;
  }, [items, statuses, searchQuery]);

  return {
    filteredItems,
    totalItems: items.length,
    filteredCount: filteredItems.length,
    isFiltered: statuses.length > 0 || !!searchQuery,
  };
}
