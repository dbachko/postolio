import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Filter, Search, X } from 'lucide-react';
import { useCalendarFilterStore, type ContentStatus } from '@/stores/calendarFilterStore';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { STATUS_OPTIONS } from '../utils';
import { getPostStatusTextClass } from '@/utils/post-status-colors';

export function ContentFiltersBar() {
  const [isOpen, setIsOpen] = useState(false);
  const statuses = useCalendarFilterStore((s) => s.statuses);
  const searchQuery = useCalendarFilterStore((s) => s.searchQuery);
  const setStatuses = useCalendarFilterStore((s) => s.setStatuses);
  const setSearchQuery = useCalendarFilterStore((s) => s.setSearchQuery);
  const clearAll = useCalendarFilterStore((s) => s.clearAll);
  const toggleStatus = useCalendarFilterStore((s) => s.toggleStatus);

  const hasAnyActiveFilters = statuses.length > 0 || !!searchQuery;
  const activeFilterCount = (statuses.length > 0 ? 1 : 0) + (searchQuery ? 1 : 0);
  const isFiltersActive = isOpen || hasAnyActiveFilters;
  const statusIcon: Record<ContentStatus, React.ComponentType<{ className?: string }>> = {
    draft: Clock,
    scheduled: Clock,
    published: CheckCircle2,
    failed: AlertTriangle,
    skipped: AlertTriangle,
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
                  Reset Filters
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

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="bg-background rounded-lg border p-4 lg:col-span-2">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold">Search</div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-primary hover:text-primary h-auto px-0 py-0 text-sm font-medium hover:bg-transparent"
                    disabled={!searchQuery}
                    onClick={() => setSearchQuery('')}
                  >
                    Clear
                  </Button>
                </div>

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
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold">Post status</div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-primary hover:text-primary h-auto px-0 py-0 text-sm font-medium hover:bg-transparent"
                    disabled={statuses.length === 0}
                    onClick={() => setStatuses([])}
                  >
                    Unselect all
                  </Button>
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
