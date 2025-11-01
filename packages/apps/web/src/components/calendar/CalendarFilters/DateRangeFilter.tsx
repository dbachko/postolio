import { memo, useState } from 'react';
import { useCalendarFilterStore } from '../../../stores/calendarFilterStore';
import { useAuthStore } from '../../../stores/authStore';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Calendar as CalendarIcon } from 'lucide-react';
import { formatDateRange } from './utils';

interface DateRangeFilterProps {
  compact?: boolean;
}

export const DateRangeFilter = memo(({ compact = false }: DateRangeFilterProps) => {
  const dateRange = useCalendarFilterStore((s) => s.dateRange);
  const setDateRange = useCalendarFilterStore((s) => s.setDateRange);
  const user = useAuthStore((s) => s.user);
  const weekStartsOn = user?.weekStart === 'monday' ? 1 : 0;
  const [isOpen, setIsOpen] = useState(false);
  const [tempDateRange, setTempDateRange] = useState({
    start: dateRange.start,
    end: dateRange.end,
  });

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      // Sync temp state with current store state when opening
      setTempDateRange({ start: dateRange.start, end: dateRange.end });
    }
  };

  const handleApply = () => {
    setDateRange(tempDateRange.start, tempDateRange.end);
    setIsOpen(false);
  };

  const handleClear = () => {
    setTempDateRange({ start: null, end: null });
    setDateRange(null, null);
    setIsOpen(false);
  };

  const setPreset = (days: number, isFuture = false) => {
    const today = new Date();
    const target = new Date(today.getTime() + (isFuture ? days : -days) * 24 * 60 * 60 * 1000);
    setTempDateRange(isFuture ? { start: today, end: target } : { start: target, end: today });
  };

  return (
    <div>
      <Label className={`mb-1 text-xs ${compact ? 'sr-only' : ''}`}>Date Range</Label>
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size={compact ? 'sm' : 'default'}
            className={`w-full justify-start ${compact ? 'h-8 text-xs' : ''}`}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {dateRange.start || dateRange.end ? (
              <span className="text-sm">{formatDateRange(dateRange.start, dateRange.end)}</span>
            ) : (
              'All dates'
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-4" align="start">
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPreset(7)}>
                Last 7 days
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPreset(30)}>
                Last 30 days
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPreset(7, true)}>
                Next 7 days
              </Button>
            </div>

            <div className="grid gap-2">
              <div>
                <Label className="text-xs">From</Label>
                <Calendar
                  mode="single"
                  selected={tempDateRange.start || undefined}
                  onSelect={(date: Date | undefined) =>
                    setTempDateRange((prev) => ({
                      ...prev,
                      start: date || null,
                    }))
                  }
                  className="rounded-md border"
                  weekStartsOn={weekStartsOn as any}
                />
              </div>
              <div>
                <Label className="text-xs">To</Label>
                <Calendar
                  mode="single"
                  selected={tempDateRange.end || undefined}
                  onSelect={(date: Date | undefined) =>
                    setTempDateRange((prev) => ({
                      ...prev,
                      end: date || null,
                    }))
                  }
                  className="rounded-md border"
                  weekStartsOn={weekStartsOn as any}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={handleClear}>
                Clear
              </Button>
              <Button size="sm" onClick={handleApply}>
                Apply
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
});
