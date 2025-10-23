import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import type { CalendarItem } from '../types/calendar';
import { convertUTCToLocal, convertLocalToUTC } from '../lib/timezone';
import { PostPreviewCard } from './PostPreviewCard';
import { RescheduleDialog } from './RescheduleDialog';
import { useQueryClient } from '@tanstack/react-query';
import { content as contentApi } from '@/lib/api';
import { toast } from 'sonner';

interface MonthGridViewProps {
  items: CalendarItem[];
  currentDate: Date; // which month to show
  timezone: string;
}

// Group items by local day key (yyyy-MM-dd) in the provided timezone
function groupByLocalDay(items: CalendarItem[], timezone: string) {
  const map = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const scheduled = (item as any)?.scheduledAt || (item as any)?.postedAt;
    if (!scheduled) continue; // skip items with no time on calendar
    const date = convertUTCToLocal(scheduled, timezone);
    const key = format(date, 'yyyy-MM-dd');
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }

  // Sort each day's items by time ascending
  map.forEach((arr) => {
    arr.sort((a, b) => {
      const aTs = (a as any)?.postedAt || (a as any)?.scheduledAt;
      const bTs = (b as any)?.postedAt || (b as any)?.scheduledAt;
      const aDate = aTs ? convertUTCToLocal(aTs, timezone).getTime() : 0;
      const bDate = bTs ? convertUTCToLocal(bTs, timezone).getTime() : 0;
      return aDate - bDate;
    });
  });

  return map;
}

export function MonthGridView({ items, currentDate, timezone }: MonthGridViewProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [rescheduleItem, setRescheduleItem] = useState<CalendarItem | null>(null);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const start = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 0 });
  const end = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 0 });

  const days: Date[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    days.push(d);
  }

  const byDay = useMemo(() => groupByLocalDay(items, timezone), [items, timezone]);

  const weekdayLabels = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b text-xs font-medium text-gray-500">
        {weekdayLabels.map((d) => (
          <div key={d} className="px-3 py-2">
            {d}
          </div>
        ))}
      </div>

      {/* Month grid */}
      <div className="grid grid-cols-7 gap-px bg-gray-200">
        {days.map((date) => {
          const isInMonth = isSameMonth(date, currentDate);
          const key = format(date, 'yyyy-MM-dd');
          const dayItems = byDay.get(key) || [];
          const today = isToday(date);
          const handleCreateForDate = () => {
            const local = new Date(date);
            // Default to 9:00 AM in brand timezone for clarity
            local.setHours(9, 0, 0, 0);
            const utc = convertLocalToUTC(local, timezone);
            const params = new URLSearchParams({ scheduledAt: utc.toISOString() });
            navigate(`/posts/create?${params.toString()}`);
          };

          return (
            <div
              key={key}
              className="group relative min-h-[140px] bg-white p-2 transition-colors hover:bg-blue-50/40"
            >
              {/* Day header */}
              <div className="mb-2 flex items-center justify-between">
                <div
                  className={`text-xs font-medium ${isInMonth ? 'text-gray-900' : 'text-gray-400'}`}
                >
                  {format(date, 'd')}
                </div>
                {today && (
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
                    Today
                  </span>
                )}
              </div>

              {/* Hover create button */}
              <button
                type="button"
                onClick={handleCreateForDate}
                className="absolute right-2 top-2 hidden items-center gap-1 rounded-md border border-blue-200 bg-white/90 px-2 py-0.5 text-[11px] font-medium text-blue-700 shadow-sm hover:bg-blue-50 group-hover:flex"
                title="Create post"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New
              </button>

              {/* Items stacked vertically */}
              <div className="flex flex-col gap-2">
                {dayItems.map((it) => (
                  <PostPreviewCard
                    key={`${it.type}-${it.id}`}
                    item={it}
                    timezone={timezone}
                    onReschedule={(item) => {
                      setRescheduleItem(item);
                      setRescheduleOpen(true);
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {rescheduleItem && rescheduleItem.type !== 'placeholder' && (
        <RescheduleDialog
          open={rescheduleOpen}
          onOpenChange={setRescheduleOpen}
          currentISO={(rescheduleItem as any).scheduledAt || (rescheduleItem as any).postedAt}
          timezone={timezone}
          onSave={async (utcISO: string) => {
            await contentApi.updateContent({
              contentId: (rescheduleItem as any).id,
              scheduledAt: utcISO,
            });
            toast.success('Post rescheduled');
            queryClient.invalidateQueries({ queryKey: ['calendar'] });
            setRescheduleOpen(false);
          }}
        />
      )}
    </div>
  );
}
