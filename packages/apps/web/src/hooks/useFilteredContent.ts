import { useMemo } from 'react';
import { useCalendarFilterStore, type CalendarFilterState } from '../stores/calendarFilterStore';
import { useShallow } from 'zustand/react/shallow';

interface ContentItem {
  id: string;
  type: 'content' | 'placeholder';
  caption: string;
  status: string;
  scheduledAt?: string | null;
  campaignId?: string | null;
  campaignName?: string;
  hashtags: string[];
  createdAt?: string;
  postedAt?: string | null;
  brandId: string;
  imageUrl?: string;
  instagramPermalink?: string | null;
}

export function useFilteredContent(items: ContentItem[]) {
  const selectFilters = useShallow((s: CalendarFilterState) => ({
    campaigns: s.campaigns,
    statuses: s.statuses,
    contentTypes: s.contentTypes,
    dateRange: s.dateRange,
    searchQuery: s.searchQuery,
  }));
  const { campaigns, statuses, contentTypes, dateRange, searchQuery } =
    useCalendarFilterStore(selectFilters);

  const filteredItems = useMemo(() => {
    let filtered = [...items];

    // Filter by campaigns
    if (campaigns.length > 0) {
      // Special case: 'none' means show only posts without campaigns
      if (campaigns.includes('none')) {
        filtered = filtered.filter((item) => !item.campaignId);
      } else {
        filtered = filtered.filter(
          (item) => item.campaignId && campaigns.includes(item.campaignId)
        );
      }
    }

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

    // Filter by content type
    if (contentTypes.length > 0 && contentTypes.length < 2) {
      filtered = filtered.filter((item) => {
        const itemType = item.type === 'placeholder' ? 'placeholder' : 'post';
        return contentTypes.includes(itemType as 'post' | 'placeholder');
      });
    }

    // Filter by date range
    if (dateRange.start || dateRange.end) {
      filtered = filtered.filter((item) => {
        if (!item.scheduledAt) return false;
        const itemDate = new Date(item.scheduledAt);

        if (dateRange.start && itemDate < dateRange.start) {
          return false;
        }
        if (dateRange.end && itemDate > dateRange.end) {
          return false;
        }
        return true;
      });
    }

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((item) => {
        const caption = (item.caption || '').toLowerCase();
        const hashtags = (item.hashtags || []).join(' ').toLowerCase();
        const campaign = (item.campaignName || '').toLowerCase();

        return caption.includes(query) || hashtags.includes(query) || campaign.includes(query);
      });
    }

    return filtered;
  }, [items, campaigns, statuses, contentTypes, dateRange, searchQuery]);

  return {
    filteredItems,
    totalItems: items.length,
    filteredCount: filteredItems.length,
    isFiltered:
      campaigns.length > 0 ||
      statuses.length > 0 ||
      contentTypes.length !== 2 ||
      !!dateRange.start ||
      !!dateRange.end ||
      !!searchQuery,
  };
}
