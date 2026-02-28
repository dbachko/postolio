import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ContentStatus } from '@/stores/calendarFilterStore';
import { getPostStatusTextClass } from '@/utils/post-status-colors';
import { STATUS_OPTIONS } from '../../utils';
import { getSeriesColorById, STATUS_ICON } from './content-filters-helpers';
import type { SeriesOption } from './types';

export function AppliedFilters({
  searchQuery,
  series,
  statuses,
  seriesNameById,
  statusLabelById,
  setSearchQuery,
  toggleSeries,
  toggleStatus,
}: {
  searchQuery: string;
  series: string[];
  statuses: ContentStatus[];
  seriesNameById: Map<string, string>;
  statusLabelById: Map<ContentStatus, string>;
  setSearchQuery: (value: string) => void;
  toggleSeries: (seriesId: string) => void;
  toggleStatus: (status: ContentStatus) => void;
}) {
  return (
    <div className="bg-background mb-4 rounded-lg border p-3">
      <div className="mb-2 text-sm font-semibold">Applied filters</div>
      <div className="flex flex-wrap gap-2">
        {searchQuery ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 rounded-full px-3"
            onClick={() => setSearchQuery('')}
          >
            Search: {searchQuery}
            <X className="ml-1 h-3.5 w-3.5" />
          </Button>
        ) : null}
        {series.map((seriesId) => (
          <Button
            key={`series-${seriesId}`}
            type="button"
            variant="outline"
            size="sm"
            className="h-7 rounded-full px-3"
            onClick={() => toggleSeries(seriesId)}
          >
            {seriesNameById.get(seriesId) || seriesId}
            <X className="ml-1 h-3.5 w-3.5" />
          </Button>
        ))}
        {statuses.map((status) => (
          <Button
            key={`status-${status}`}
            type="button"
            variant="outline"
            size="sm"
            className="h-7 rounded-full px-3"
            onClick={() => toggleStatus(status)}
          >
            {statusLabelById.get(status) || status}
            <X className="ml-1 h-3.5 w-3.5" />
          </Button>
        ))}
      </div>
    </div>
  );
}

export function SearchSection({
  searchQuery,
  setSearchQuery,
}: {
  searchQuery: string;
  setSearchQuery: (value: string) => void;
}) {
  return (
    <div className="bg-background rounded-lg border p-4 lg:col-span-2">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search captions or hashtags"
          className="h-9 pr-10 pl-9"
        />
        {searchQuery ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSearchQuery('')}
            className="absolute top-1/2 right-2 h-7 w-7 -translate-y-1/2 p-0 hover:bg-transparent"
            aria-label="Clear search"
          >
            <X className="text-muted-foreground h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function SeriesSection({
  series,
  seriesOptions,
  toggleSeries,
}: {
  series: string[];
  seriesOptions: SeriesOption[];
  toggleSeries: (seriesId: string) => void;
}) {
  return (
    <div className="bg-background rounded-lg border p-4">
      <div className="mb-3 text-sm font-semibold">
        Series
        {series.length > 0 ? (
          <span className="text-muted-foreground ml-1 text-xs font-normal">({series.length})</span>
        ) : null}
      </div>
      <div className="max-h-[17rem] space-y-1 overflow-auto pr-1">
        {seriesOptions.map((option) => {
          const checked = series.includes(option.id);
          const seriesColor =
            typeof option.color === 'string' && option.color.trim().length > 0
              ? option.color
              : getSeriesColorById(option.id);
          const id = `calendar-filter-series-${option.id}`;
          return (
            <label
              key={option.id}
              htmlFor={id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1"
            >
              <Checkbox
                id={id}
                checked={checked}
                onCheckedChange={() => toggleSeries(option.id)}
                className="h-3.5 w-3.5"
              />
              <span
                className={cn(
                  'border-border inline-flex h-3 w-3 shrink-0 rounded-full border',
                  checked ? 'opacity-100' : 'opacity-40'
                )}
                style={{ backgroundColor: seriesColor }}
                aria-hidden="true"
              />
              <span className="text-sm">{option.name}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function StatusSection({
  statuses,
  toggleStatus,
}: {
  statuses: ContentStatus[];
  toggleStatus: (status: ContentStatus) => void;
}) {
  return (
    <div className="bg-background rounded-lg border p-4">
      <div className="mb-3 text-sm font-semibold">
        Post status
        {statuses.length > 0 ? (
          <span className="text-muted-foreground ml-1 text-xs font-normal">
            ({statuses.length})
          </span>
        ) : null}
      </div>
      <div className="space-y-1">
        {STATUS_OPTIONS.map((option) => {
          const checked = statuses.includes(option.value);
          const id = `calendar-filter-status-${option.value}`;
          const Icon = STATUS_ICON[option.value];
          return (
            <label
              key={option.value}
              htmlFor={id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1"
            >
              <Checkbox
                id={id}
                checked={checked}
                onCheckedChange={() => toggleStatus(option.value)}
                className="h-3.5 w-3.5"
              />
              <span
                className={cn(
                  'inline-flex h-4 w-4 items-center justify-center',
                  getPostStatusTextClass(option.value),
                  checked ? 'opacity-100' : 'opacity-40'
                )}
                aria-hidden="true"
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-sm">{option.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
