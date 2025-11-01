import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCalendarFilterStore } from '../stores/calendarFilterStore';
import { encodeFiltersToURL, decodeFiltersFromURL, areFiltersEqual } from '../utils/filterUrlUtils';

const haveSameMembers = <T extends string>(a: readonly T[], b: readonly T[]): boolean => {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
};

/**
 * Synchronizes calendar filter state between URL and Zustand store
 * - On mount/URL change: Updates store from URL
 * - On store change: Updates URL from store
 */
export function useURLFilterSync() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const campaigns = useCalendarFilterStore((state) => state.campaigns);
  const statuses = useCalendarFilterStore((state) => state.statuses);
  const contentTypes = useCalendarFilterStore((state) => state.contentTypes);
  const dateRange = useCalendarFilterStore((state) => state.dateRange);
  const searchQuery = useCalendarFilterStore((state) => state.searchQuery);

  // Track if we're updating from URL to prevent infinite loops
  const isUpdatingFromURL = useRef(false);
  const isUpdatingFromStore = useRef(false);

  // Sync URL → Store (on mount and URL changes)
  useEffect(() => {
    if (isUpdatingFromStore.current) {
      isUpdatingFromStore.current = false;
      return;
    }

    const urlFilters = decodeFiltersFromURL(searchParams);
    const store = useCalendarFilterStore.getState();
    const currentState = {
      campaigns: store.campaigns,
      statuses: store.statuses,
      contentTypes: store.contentTypes,
      dateRange: store.dateRange,
      searchQuery: store.searchQuery,
    };

    if (!areFiltersEqual(urlFilters, currentState)) {
      isUpdatingFromURL.current = true;

      if (!haveSameMembers(urlFilters.campaigns, currentState.campaigns)) {
        store.setCampaigns(urlFilters.campaigns);
      }

      if (!haveSameMembers(urlFilters.statuses, currentState.statuses)) {
        store.setStatuses(urlFilters.statuses);
      }

      if (!haveSameMembers(urlFilters.contentTypes, currentState.contentTypes)) {
        store.setContentTypes(urlFilters.contentTypes);
      }

      if (
        urlFilters.dateRange.start?.getTime() !== currentState.dateRange.start?.getTime() ||
        urlFilters.dateRange.end?.getTime() !== currentState.dateRange.end?.getTime()
      ) {
        store.setDateRange(urlFilters.dateRange.start, urlFilters.dateRange.end);
      }

      if (urlFilters.searchQuery !== currentState.searchQuery) {
        store.setSearchQuery(urlFilters.searchQuery);
      }
    }
  }, [searchParams]);

  // Sync Store → URL (when store changes)
  useEffect(() => {
    if (isUpdatingFromURL.current) {
      isUpdatingFromURL.current = false;
      return;
    }

    isUpdatingFromStore.current = true;
    const currentParams = new URLSearchParams(window.location.search);

    ['campaigns', 'statuses', 'types', 'dateStart', 'dateEnd', 'search'].forEach((key) =>
      currentParams.delete(key)
    );

    const currentState = {
      campaigns,
      statuses,
      contentTypes,
      dateRange,
      searchQuery,
    };

    const encoded = encodeFiltersToURL(currentState);
    encoded.forEach((value, key) => currentParams.set(key, value));

    const newSearch = currentParams.toString();
    const currentSearch = window.location.search.slice(1);

    if (newSearch !== currentSearch) {
      navigate(`?${newSearch}`, { replace: true });
    }
  }, [campaigns, statuses, contentTypes, dateRange, searchQuery, navigate]);
}

export function useNavigateWithFilters() {
  const navigate = useNavigate();

  return (
    filters: Partial<{
      campaigns: string[];
      statuses: string[];
      contentTypes: string[];
      dateRange: { start: Date | null; end: Date | null };
      searchQuery: string;
    }>
  ) => {
    const params = new URLSearchParams();

    if (filters.campaigns?.length) {
      params.set('campaigns', filters.campaigns.join(','));
    }
    if (filters.statuses?.length) {
      params.set('statuses', filters.statuses.join(','));
    }
    if (filters.contentTypes?.length) {
      params.set('types', filters.contentTypes.join(','));
    }
    if (filters.dateRange?.start) {
      params.set('dateStart', filters.dateRange.start.toISOString().split('T')[0]);
    }
    if (filters.dateRange?.end) {
      params.set('dateEnd', filters.dateRange.end.toISOString().split('T')[0]);
    }
    if (filters.searchQuery) {
      params.set('search', filters.searchQuery);
    }

    navigate(`/content?${params.toString()}`);
  };
}
