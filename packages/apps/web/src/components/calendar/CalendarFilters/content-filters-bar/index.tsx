import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Filter, Search, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useCalendarFilterStore, type ContentStatus } from '@/stores/calendarFilterStore';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { STATUS_OPTIONS } from '../utils';
import { getPostStatusTextClass } from '@/utils/post-status-colors';
import { brand as brandApi } from '@/lib/api';

type ContentFiltersBarProps = {
  brandId: string;
};

export function ContentFiltersBar({ brandId }: ContentFiltersBarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const series = useCalendarFilterStore((s) => s.series);
  const statuses = useCalendarFilterStore((s) => s.statuses);
  const searchQuery = useCalendarFilterStore((s) => s.searchQuery);
  const setSeries = useCalendarFilterStore((s) => s.setSeries);
  const setSearchQuery = useCalendarFilterStore((s) => s.setSearchQuery);
  const clearAll = useCalendarFilterStore((s) => s.clearAll);
  const toggleStatus = useCalendarFilterStore((s) => s.toggleStatus);

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
      ...list.map((s: any) => ({
        id: String(s.id),
        name: String(s.name || 'Series'),
        color: typeof s.color === 'string' && s.color.trim().length > 0 ? s.color.trim() : null,
      })),
    ];
  }, [seriesQuery.data]);
  const seriesNameById = useMemo(
    () => new Map(seriesOptions.map((option) => [option.id, option.name] as const)),
    [seriesOptions]
  );
  const statusLabelById = useMemo(
    () => new Map(STATUS_OPTIONS.map((option) => [option.value, option.label] as const)),
    []
  );

  const hasAnyActiveFilters = series.length > 0 || statuses.length > 0 || !!searchQuery;
  const activeFilterCount =
    (series.length > 0 ? 1 : 0) + (statuses.length > 0 ? 1 : 0) + (searchQuery ? 1 : 0);
  const isFiltersActive = isOpen || hasAnyActiveFilters;
  const statusIcon: Record<ContentStatus, React.ComponentType<{ className?: string }>> = {
    draft: Clock,
    scheduled: Clock,
    published: CheckCircle2,
    failed: AlertTriangle,
    skipped: AlertTriangle,
  };

  const toggleSeries = (seriesId: string) => {
    const clean = seriesId.trim();
    if (!clean) {
      return;
    }
    const next = series.includes(clean) ? series.filter((s) => s !== clean) : [...series, clean];
    setSeries(next);
  };

  const seriesColorById = (id: string): string => {
    if (id === 'none') {
      return 'hsl(var(--muted-foreground))';
    }
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    }
    const hue = hash % 360;
    return `hsl(${hue} 68% 48%)`;
  };

  return (
    <div className="relative">
      <Button
        variant={isFiltersActive ? 'default' : 'outline'}
        size="icon"
        aria-label={isFiltersActive ? 'Hide filters' : 'Show filters'}
        aria-pressed={isFiltersActive}
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative h-10 w-10"
      >
        <Filter className="h-4 w-4" />
        {hasAnyActiveFilters && (
          <span
            className={`absolute -top-1 -right-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-medium ${
              isFiltersActive
                ? 'bg-background text-foreground ring-ring ring-1'
                : 'bg-foreground text-background'
            }`}
          >
            {activeFilterCount}
          </span>
        )}
      </Button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} aria-hidden="true" />

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
                  onClick={() => setIsOpen(false)}
                  className="h-8 w-8"
                  aria-label="Close filters"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {hasAnyActiveFilters ? (
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
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="bg-background rounded-lg border p-4 lg:col-span-2">
                <div className="relative">
                  <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search captions or hashtags"
                    className="h-9 pr-10 pl-9"
                  />
                  {searchQuery && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSearchQuery('')}
                      className="absolute top-1/2 right-2 h-7 w-7 -translate-y-1/2 p-0 hover:bg-transparent"
                      aria-label="Clear search"
                    >
                      <X className="text-muted-foreground h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="bg-background rounded-lg border p-4">
                <div className="mb-3 text-sm font-semibold">
                  Series
                  {series.length > 0 ? (
                    <span className="text-muted-foreground ml-1 text-xs font-normal">
                      ({series.length})
                    </span>
                  ) : null}
                </div>

                <div className="max-h-[17rem] space-y-1 overflow-auto pr-1">
                  {seriesOptions.map((option) => {
                    const checked = series.includes(option.id);
                    const id = `calendar-filter-series-${option.id}`;
                    const seriesColor =
                      typeof option.color === 'string' && option.color.trim().length > 0
                        ? option.color
                        : seriesColorById(option.id);
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
                    const Icon = statusIcon[option.value];
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
            </div>
          </div>
        </>
      )}
    </div>
  );
}
