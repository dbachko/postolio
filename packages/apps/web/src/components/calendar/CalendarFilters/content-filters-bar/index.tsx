import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { brand as brandApi } from '@/lib/api';
import { useCalendarFilterStore, type ContentStatus } from '@/stores/calendarFilterStore';
import { STATUS_OPTIONS } from '../utils';
import { FiltersPanel, FiltersTriggerButton } from './components/content-filters-panel';
import type { SeriesOption } from './components/types';

type ContentFiltersBarProps = {
  brandId: string;
};

function useSeriesOptions(brandId: string) {
  const seriesQuery = useQuery({
    queryKey: ['content-series', brandId],
    enabled: Boolean(brandId),
    queryFn: () => brandApi.getContentSeries(brandId),
    staleTime: 60_000,
  });

  const seriesOptions = useMemo(() => {
    const list = seriesQuery.data?.data?.series ?? [];
    return [
      { id: 'none', name: 'No series', color: 'hsl(var(--muted-foreground))' as const },
      ...list.map((series: any) => ({
        id: String(series.id),
        name: String(series.name || 'Series'),
        color:
          typeof series.color === 'string' && series.color.trim().length > 0
            ? series.color.trim()
            : null,
      })),
    ] as SeriesOption[];
  }, [seriesQuery.data]);

  return { seriesOptions };
}

function useContentFiltersModel(brandId: string) {
  const series = useCalendarFilterStore((state) => state.series);
  const statuses = useCalendarFilterStore((state) => state.statuses);
  const searchQuery = useCalendarFilterStore((state) => state.searchQuery);
  const setSeries = useCalendarFilterStore((state) => state.setSeries);
  const setSearchQuery = useCalendarFilterStore((state) => state.setSearchQuery);
  const clearAll = useCalendarFilterStore((state) => state.clearAll);
  const toggleStatus = useCalendarFilterStore((state) => state.toggleStatus);

  const { seriesOptions } = useSeriesOptions(brandId);
  const seriesNameById = useMemo(
    () => new Map(seriesOptions.map((option) => [option.id, option.name] as const)),
    [seriesOptions]
  );
  const statusLabelById = useMemo(
    () => new Map(STATUS_OPTIONS.map((option) => [option.value, option.label] as const)),
    []
  );

  const hasAnyActiveFilters = series.length > 0 || statuses.length > 0 || Boolean(searchQuery);
  const activeFilterCount =
    (series.length > 0 ? 1 : 0) + (statuses.length > 0 ? 1 : 0) + (searchQuery ? 1 : 0);

  const toggleSeries = (seriesId: string) => {
    const normalizedId = seriesId.trim();
    if (!normalizedId) {
      return;
    }

    const next = series.includes(normalizedId)
      ? series.filter((currentSeriesId) => currentSeriesId !== normalizedId)
      : [...series, normalizedId];
    setSeries(next);
  };

  return {
    series,
    statuses,
    searchQuery,
    setSearchQuery,
    clearAll,
    toggleStatus,
    seriesOptions,
    seriesNameById,
    statusLabelById,
    hasAnyActiveFilters,
    activeFilterCount,
    toggleSeries,
  };
}

export function ContentFiltersBar({ brandId }: ContentFiltersBarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const model = useContentFiltersModel(brandId);

  return (
    <div className="relative">
      <FiltersTriggerButton
        isOpen={isOpen}
        hasAnyActiveFilters={model.hasAnyActiveFilters}
        activeFilterCount={model.activeFilterCount}
        onToggle={() => setIsOpen((previousIsOpen) => !previousIsOpen)}
      />
      {isOpen ? (
        <FiltersPanel
          hasAnyActiveFilters={model.hasAnyActiveFilters}
          searchQuery={model.searchQuery}
          series={model.series}
          statuses={model.statuses as ContentStatus[]}
          seriesNameById={model.seriesNameById}
          statusLabelById={model.statusLabelById}
          setSearchQuery={model.setSearchQuery}
          clearAll={model.clearAll}
          toggleSeries={model.toggleSeries}
          toggleStatus={model.toggleStatus}
          seriesOptions={model.seriesOptions}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </div>
  );
}
