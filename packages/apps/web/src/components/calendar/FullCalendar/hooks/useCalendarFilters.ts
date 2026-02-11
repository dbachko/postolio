import { useCalendarFilterStore } from '@/stores/calendarFilterStore';
import { useShallow } from 'zustand/react/shallow';
import type { CalendarFilters } from '../types';

export function useCalendarFilters(): CalendarFilters {
  return useCalendarFilterStore(
    useShallow((state) => ({
      statuses: state.statuses,
      searchQuery: state.searchQuery,
    }))
  );
}
