import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ContentStatus = 'draft' | 'scheduled' | 'published' | 'failed' | 'skipped';
export type ContentType = 'post' | 'placeholder';

interface DateRange {
  start: Date | null;
  end: Date | null;
}

export interface CalendarFilterState {
  // Filter values
  campaigns: string[];
  statuses: ContentStatus[];
  contentTypes: ContentType[];
  dateRange: DateRange;
  searchQuery: string;

  // Actions
  setCampaigns: (campaigns: string[]) => void;
  setStatuses: (statuses: ContentStatus[]) => void;
  toggleStatus: (status: ContentStatus) => void;
  setContentTypes: (types: ContentType[]) => void;
  toggleContentType: (type: ContentType) => void;
  setDateRange: (start: Date | null, end: Date | null) => void;
  setSearchQuery: (query: string) => void;
  clearAll: () => void;

  // Helper methods
  hasActiveFilters: () => boolean;
  getActiveFilterCount: () => number;
}

const initialState = {
  campaigns: [],
  statuses: [],
  contentTypes: ['post', 'placeholder'] as ContentType[],
  dateRange: { start: null, end: null },
  searchQuery: '',
};

export const useCalendarFilterStore = create<CalendarFilterState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setCampaigns: (campaigns) => {
        const prev = get().campaigns;
        try {
          if (isDebugFiltersEnabled())
            console.debug('[filters] setCampaigns', { prev, next: campaigns });
        } catch {}
        set({ campaigns });
      },

      setStatuses: (statuses) => {
        const prev = get().statuses;
        if (haveSameMembers(prev, statuses)) return;
        try {
          if (isDebugFiltersEnabled())
            console.debug('[filters] setStatuses', { prev, next: statuses });
        } catch {}
        set({ statuses });
      },

      toggleStatus: (status) =>
        set((state) => {
          const next = state.statuses.includes(status)
            ? state.statuses.filter((s) => s !== status)
            : [...state.statuses, status];
          try {
            if (isDebugFiltersEnabled())
              console.debug('[filters] toggleStatus', { status, prev: state.statuses, next });
          } catch {}
          return { statuses: next };
        }),

      setContentTypes: (types) => {
        const prev = get().contentTypes;
        if (haveSameMembers(prev, types)) return;
        try {
          if (isDebugFiltersEnabled())
            console.debug('[filters] setContentTypes', { prev, next: types });
        } catch {}
        set({ contentTypes: types });
      },

      toggleContentType: (type) =>
        set((state) => {
          const next = state.contentTypes.includes(type)
            ? state.contentTypes.filter((t) => t !== type)
            : [...state.contentTypes, type];
          try {
            if (isDebugFiltersEnabled())
              console.debug('[filters] toggleContentType', {
                type,
                prev: state.contentTypes,
                next,
              });
          } catch {}
          return { contentTypes: next };
        }),

      setDateRange: (start, end) => {
        try {
          if (isDebugFiltersEnabled()) console.debug('[filters] setDateRange', { start, end });
        } catch {}
        set({ dateRange: { start, end } });
      },

      setSearchQuery: (query) => {
        try {
          if (isDebugFiltersEnabled()) console.debug('[filters] setSearchQuery', { query });
        } catch {}
        set({ searchQuery: query });
      },

      clearAll: () => {
        try {
          if (isDebugFiltersEnabled()) console.debug('[filters] clearAll');
        } catch {}
        set(initialState);
      },

      hasActiveFilters: () => {
        const state = get();
        return (
          state.campaigns.length > 0 ||
          state.statuses.length > 0 ||
          state.contentTypes.length !== 2 || // Not showing all types
          state.dateRange.start !== null ||
          state.dateRange.end !== null ||
          state.searchQuery.length > 0
        );
      },

      getActiveFilterCount: () => {
        const state = get();
        let count = 0;
        if (state.campaigns.length > 0) count++;
        if (state.statuses.length > 0) count++;
        if (state.contentTypes.length !== 2) count++;
        if (state.dateRange.start || state.dateRange.end) count++;
        if (state.searchQuery.length > 0) count++;
        return count;
      },
    }),
    {
      name: 'calendar-filters',
      partialize: (state) => ({
        campaigns: state.campaigns,
        statuses: state.statuses,
        contentTypes: state.contentTypes,
        searchQuery: state.searchQuery,
        dateRange: {
          start: state.dateRange.start?.toISOString() || null,
          end: state.dateRange.end?.toISOString() || null,
        },
      }),
      merge: (persistedState: unknown, currentState) => {
        const safe = (persistedState as Partial<CalendarFilterState>) || {};
        const dateRangeRaw: any = (safe as any).dateRange || {};
        return {
          ...currentState,
          ...safe,
          dateRange: {
            start: dateRangeRaw.start ? new Date(dateRangeRaw.start) : null,
            end: dateRangeRaw.end ? new Date(dateRangeRaw.end) : null,
          },
        };
      },
    }
  )
);

function haveSameMembers<T extends string>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

function isDebugFiltersEnabled(): boolean {
  try {
    // Enable via localStorage or ?debugFilters=1
    if (typeof window === 'undefined') return false;
    const ls = (window.localStorage && localStorage.getItem('debugFilters')) === '1';
    const sp = new URLSearchParams(window.location.search);
    return ls || sp.get('debugFilters') === '1';
  } catch {
    return false;
  }
}
