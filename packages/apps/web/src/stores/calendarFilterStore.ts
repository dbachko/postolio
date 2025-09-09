import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ContentStatus =
  | "draft"
  | "scheduled"
  | "published"
  | "failed"
  | "skipped";
export type ContentType = "post" | "placeholder";

interface DateRange {
  start: Date | null;
  end: Date | null;
}

interface CalendarFilterState {
  // Filter values
  campaigns: string[];
  statuses: ContentStatus[];
  contentTypes: ContentType[];
  dateRange: DateRange;
  searchQuery: string;

  // Actions
  setCampaigns: (campaigns: string[]) => void;
  toggleStatus: (status: ContentStatus) => void;
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
  contentTypes: ["post", "placeholder"] as ContentType[],
  dateRange: { start: null, end: null },
  searchQuery: "",
};

export const useCalendarFilterStore = create<CalendarFilterState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setCampaigns: (campaigns) => set({ campaigns }),

      toggleStatus: (status) =>
        set((state) => ({
          statuses: state.statuses.includes(status)
            ? state.statuses.filter((s) => s !== status)
            : [...state.statuses, status],
        })),

      toggleContentType: (type) =>
        set((state) => ({
          contentTypes: state.contentTypes.includes(type)
            ? state.contentTypes.filter((t) => t !== type)
            : [...state.contentTypes, type],
        })),

      setDateRange: (start, end) =>
        set({
          dateRange: { start, end },
        }),

      setSearchQuery: (query) => set({ searchQuery: query }),

      clearAll: () => set(initialState),

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
      name: "calendar-filters",
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
    },
  ),
);
