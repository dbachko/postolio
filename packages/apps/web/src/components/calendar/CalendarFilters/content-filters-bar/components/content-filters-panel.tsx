import { Filter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ContentStatus } from '@/stores/calendarFilterStore';
import type { SeriesOption } from './types';
import {
  AppliedFilters,
  SearchSection,
  SeriesSection,
  StatusSection,
} from './content-filters-panel-sections';

type FiltersPanelProps = {
  hasAnyActiveFilters: boolean;
  searchQuery: string;
  series: string[];
  statuses: ContentStatus[];
  seriesNameById: Map<string, string>;
  statusLabelById: Map<ContentStatus, string>;
  setSearchQuery: (value: string) => void;
  clearAll: () => void;
  toggleSeries: (seriesId: string) => void;
  toggleStatus: (status: ContentStatus) => void;
  seriesOptions: SeriesOption[];
  onClose: () => void;
};

export function FiltersTriggerButton({
  isOpen,
  hasAnyActiveFilters,
  activeFilterCount,
  onToggle,
}: {
  isOpen: boolean;
  hasAnyActiveFilters: boolean;
  activeFilterCount: number;
  onToggle: () => void;
}) {
  const isFiltersActive = isOpen || hasAnyActiveFilters;
  return (
    <Button
      variant={isFiltersActive ? 'default' : 'outline'}
      size="icon"
      aria-label={isFiltersActive ? 'Hide filters' : 'Show filters'}
      aria-pressed={isFiltersActive}
      onClick={onToggle}
      className="relative h-10 w-10"
    >
      <Filter className="h-4 w-4" />
      {hasAnyActiveFilters ? (
        <span
          className={cn(
            'absolute -top-1 -right-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-medium',
            isFiltersActive
              ? 'bg-background text-foreground ring-ring ring-1'
              : 'bg-foreground text-background'
          )}
        >
          {activeFilterCount}
        </span>
      ) : null}
    </Button>
  );
}

export function FiltersPanel({
  hasAnyActiveFilters,
  searchQuery,
  series,
  statuses,
  seriesNameById,
  statusLabelById,
  setSearchQuery,
  clearAll,
  toggleSeries,
  toggleStatus,
  seriesOptions,
  onClose,
}: FiltersPanelProps) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div className="bg-card absolute top-12 right-0 z-50 w-[min(40rem,calc(100vw-2rem))] rounded-lg border p-4 shadow-lg">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-base font-semibold">Calendar Filters</h3>
            <p className="text-muted-foreground text-sm">Filter by status or search.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearAll}
              disabled={!hasAnyActiveFilters}
            >
              Clear all
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8"
              aria-label="Close filters"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {hasAnyActiveFilters ? (
          <AppliedFilters
            searchQuery={searchQuery}
            series={series}
            statuses={statuses}
            seriesNameById={seriesNameById}
            statusLabelById={statusLabelById}
            setSearchQuery={setSearchQuery}
            toggleSeries={toggleSeries}
            toggleStatus={toggleStatus}
          />
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <SearchSection searchQuery={searchQuery} setSearchQuery={setSearchQuery} />
          <SeriesSection
            series={series}
            seriesOptions={seriesOptions}
            toggleSeries={toggleSeries}
          />
          <StatusSection statuses={statuses} toggleStatus={toggleStatus} />
        </div>
      </div>
    </>
  );
}
