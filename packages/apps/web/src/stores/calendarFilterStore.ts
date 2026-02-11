import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ContentStatus = 'draft' | 'scheduled' | 'published' | 'failed' | 'skipped';

export interface CalendarFilterState {
  // Filter values
  statuses: ContentStatus[];
  searchQuery: string;

  // Actions
  setStatuses: (statuses: ContentStatus[]) => void;
  toggleStatus: (status: ContentStatus) => void;
  setSearchQuery: (query: string) => void;
  clearAll: () => void;

  // Helper methods
  hasActiveFilters: () => boolean;
  getActiveFilterCount: () => number;
}

const initialState = {
  statuses: [],
  searchQuery: '',
};

export const useCalendarFilterStore = create<CalendarFilterState>()(
  persist(
    (set, get) => ({
      ...initialState,

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
        return state.statuses.length > 0 || state.searchQuery.length > 0;
      },

      getActiveFilterCount: () => {
        const state = get();
        let count = 0;
        if (state.statuses.length > 0) count++;
        if (state.searchQuery.length > 0) count++;
        return count;
      },
    }),
    {
      name: 'calendar-filters',
      partialize: (state) => ({
        statuses: state.statuses,
        searchQuery: state.searchQuery,
      }),
      merge: (persistedState: unknown, currentState) => {
        const safe = (persistedState as Partial<CalendarFilterState>) || {};
        return {
          ...currentState,
          statuses: Array.isArray(safe.statuses) ? safe.statuses : currentState.statuses,
          searchQuery: typeof safe.searchQuery === 'string' ? safe.searchQuery : '',
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
