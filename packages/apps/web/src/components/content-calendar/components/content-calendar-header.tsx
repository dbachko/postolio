import { format } from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, Globe2 } from 'lucide-react';
import { ContentFiltersBar } from '@/components/calendar/CalendarFilters/content-filters-bar';
import { AsyncTimezoneCombobox } from '@/components/timezone/async-timezone-combobox';
import { ContentViewSelector } from '@/components/content/content-view-selector';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ContentCalendarViewMode } from '../types';

type ContentCalendarHeaderProps = {
  brandId: string;
  currentDate: Date;
  viewMode: ContentCalendarViewMode;
  onPrevious: () => void;
  onToday: () => void;
  onNext: () => void;
  onViewModeChange: (next: ContentCalendarViewMode) => void;
  brandTimezone: string;
  onBrandTimezoneChange: (tz: string) => void;
};

export function ContentCalendarHeader({
  brandId,
  currentDate,
  viewMode,
  onPrevious,
  onToday,
  onNext,
  onViewModeChange,
  brandTimezone,
  onBrandTimezoneChange,
}: ContentCalendarHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={onPrevious}
          aria-label="Previous"
          className="h-10 w-10"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={onToday}
          aria-label="Today"
          className="h-10 w-10"
        >
          <CalendarDays className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={onNext}
          aria-label="Next"
          className="h-10 w-10"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="text-foreground ml-2 min-w-0 truncate text-sm font-semibold">
          {format(currentDate, 'MMMM yyyy')}
        </span>
      </div>

      <div className="flex flex-1 flex-wrap items-center gap-2 sm:justify-end">
        <ContentViewSelector brandId={brandId} />
        <AsyncTimezoneCombobox
          value={brandTimezone}
          onValueChange={onBrandTimezoneChange}
          leadingIcon={<Globe2 className="text-muted-foreground h-4 w-4" aria-hidden="true" />}
          buttonClassName="w-auto"
        />
        <Tabs
          value={viewMode}
          onValueChange={(v) => onViewModeChange(v as ContentCalendarViewMode)}
        >
          <TabsList className="w-auto">
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
            <TabsTrigger value="queue">Queue</TabsTrigger>
          </TabsList>
        </Tabs>
        <ContentFiltersBar />
      </div>
    </div>
  );
}
