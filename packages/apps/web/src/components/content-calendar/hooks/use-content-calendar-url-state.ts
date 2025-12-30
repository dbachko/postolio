import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format, addMonths, subMonths } from 'date-fns';
import type { ContentCalendarViewMode } from '../types';

function parseInitialViewMode(searchParams: URLSearchParams): ContentCalendarViewMode {
  const v = searchParams.get('view');
  if (v === 'month' || v === 'week' || v === 'queue') return v;
  if (typeof window !== 'undefined' && window.innerWidth < 640) return 'week';
  return 'month';
}

function parseInitialDate(searchParams: URLSearchParams, viewMode: ContentCalendarViewMode): Date {
  const dateParam = searchParams.get('date');
  if (!dateParam) return new Date();

  const isYm = /\d{4}-\d{2}$/.test(dateParam);
  const d = isYm ? new Date(`${dateParam}-01T00:00:00`) : new Date(dateParam);
  if (Number.isNaN(d.getTime())) return new Date();

  if ((viewMode === 'week' || viewMode === 'queue') && isYm) return new Date();
  return d;
}

export function useContentCalendarUrlState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialViewMode = useMemo(() => parseInitialViewMode(searchParams), [searchParams]);

  const [viewMode, setViewMode] = useState<ContentCalendarViewMode>(initialViewMode);
  const [currentDate, setCurrentDate] = useState<Date>(() =>
    parseInitialDate(searchParams, initialViewMode)
  );

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (value == null || value === '') next.delete(key);
      else next.set(key, value);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const setViewModeAndSync = useCallback(
    (next: ContentCalendarViewMode) => {
      setViewMode(next);
      setParam('view', next);
    },
    [setParam]
  );

  const handlePrevious = useCallback(() => {
    setCurrentDate((prev) => {
      let next = prev;
      if (viewMode === 'month') next = subMonths(prev, 1);
      else next = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() - 7);
      setParam('date', format(next, viewMode === 'month' ? 'yyyy-MM' : 'yyyy-MM-dd'));
      return next;
    });
  }, [setParam, viewMode]);

  const handleNext = useCallback(() => {
    setCurrentDate((prev) => {
      let next = prev;
      if (viewMode === 'month') next = addMonths(prev, 1);
      else next = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 7);
      setParam('date', format(next, viewMode === 'month' ? 'yyyy-MM' : 'yyyy-MM-dd'));
      return next;
    });
  }, [setParam, viewMode]);

  const handleToday = useCallback(() => {
    const t = new Date();
    setCurrentDate(t);
    setParam('date', format(t, viewMode === 'month' ? 'yyyy-MM' : 'yyyy-MM-dd'));
  }, [setParam, viewMode]);

  return {
    currentDate,
    handleNext,
    handlePrevious,
    handleToday,
    setViewMode: setViewModeAndSync,
    viewMode,
  };
}
