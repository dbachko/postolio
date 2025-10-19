import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { useTimezone } from '../contexts/TimezoneContext';
import { Card, CardContent } from './ui/card';
import { Clock, Calendar, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

interface TimelineItem {
  id: string;
  type: 'content' | 'placeholder';
  caption: string;
  scheduledAt?: string;
  postedAt?: string;
  status: string;
  hashtags?: string[];
  imageUrl?: string;
  campaignName?: string;
  campaignId?: string;
  processing?: boolean;
}

interface TimelineViewProps {
  items: TimelineItem[];
  currentDate: Date;
}

export function TimelineView({ items, currentDate }: TimelineViewProps) {
  const navigate = useNavigate();
  const { timezone } = useTimezone();

  // Group items by day for the current week
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  const itemsByDay = useMemo(() => {
    const grouped = new Map<string, TimelineItem[]>();

    // Initialize all days
    weekDays.forEach((day) => {
      grouped.set(format(day, 'yyyy-MM-dd'), []);
    });

    // Group items by day
    items.forEach((item) => {
      const date = item.scheduledAt || item.postedAt;
      if (date) {
        // Group by day in the user's/brand timezone
        const dayKey = formatInTimeZone(new Date(date), timezone, 'yyyy-MM-dd');
        const dayItems = grouped.get(dayKey) || [];
        dayItems.push(item);
        grouped.set(dayKey, dayItems);
      }
    });

    return grouped;
  }, [items, weekDays]);

  const getStatusColor = (status: string, type: string, processing?: boolean) => {
    if (type === 'placeholder') return 'bg-gray-100 text-gray-600 border-gray-300';
    if (processing) return 'bg-blue-100 text-blue-800 border-blue-300';
    switch (status) {
      case 'published':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'scheduled':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'failed':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'skipped':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'draft':
        return 'bg-gray-100 text-gray-800 border-gray-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getStatusIcon = (status: string, type: string, processing?: boolean) => {
    if (type === 'placeholder') return <Clock className="h-4 w-4" />;
    if (processing) return <Loader2 className="h-4 w-4 animate-spin" />;
    switch (status) {
      case 'published':
        return <CheckCircle className="h-4 w-4" />;
      case 'failed':
        return <AlertCircle className="h-4 w-4" />;
      case 'skipped':
        return <AlertCircle className="h-4 w-4" />;
      default:
        return <Calendar className="h-4 w-4" />;
    }
  };

  return (
    <Card data-testid="view-timeline">
      <CardContent className="p-6">
        <div className="space-y-6">
          {/* Timeline header with hours */}
          <div className="grid grid-cols-8 gap-4 border-b pb-2 text-sm font-medium text-gray-600">
            <div className="col-span-1">Time</div>
            {weekDays.map((day) => (
              <div
                key={day.toISOString()}
                className={`text-center ${isSameDay(day, new Date()) ? 'font-bold text-blue-600' : ''}`}
              >
                <div>{format(day, 'EEE')}</div>
                <div className="text-xs">{format(day, 'MMM d')}</div>
              </div>
            ))}
          </div>

          {/* Timeline content by hour */}
          {Array.from({ length: 24 }, (_, hour) => (
            <div key={hour} className="grid min-h-[60px] grid-cols-8 gap-4">
              <div className="col-span-1 pt-1 text-sm text-gray-500">
                {formatInTimeZone(new Date().setHours(hour, 0, 0, 0), timezone, 'ha')}
              </div>
              {weekDays.map((day) => {
                const dayKey = format(day, 'yyyy-MM-dd');
                const dayItems = itemsByDay.get(dayKey) || [];
                const hourItems = dayItems.filter((item) => {
                  const d = item.scheduledAt || item.postedAt || '';
                  const itemHour = parseInt(formatInTimeZone(new Date(d), timezone, 'H'), 10);
                  return itemHour === hour;
                });

                return (
                  <div key={`${dayKey}-${hour}`} className="relative border-l border-gray-200">
                    {hourItems.map((item, idx) => (
                      <div
                        key={item.id}
                        className={`absolute left-0 right-0 mx-1 rounded p-2 text-xs ${
                          item.type === 'placeholder'
                            ? 'border border-dashed'
                            : 'cursor-pointer border transition-shadow hover:shadow-md'
                        } ${getStatusColor(item.status, item.type, item.processing)}`}
                        style={{ top: `${idx * 25}px` }}
                        onClick={() => {
                          if (item.type === 'content') {
                            navigate(`/posts/${item.id}`);
                          } else if (item.type === 'placeholder') {
                            const params = new URLSearchParams();
                            if (item.campaignId) params.set('campaignId', item.campaignId);
                            if (item.scheduledAt) params.set('scheduledAt', item.scheduledAt);
                            navigate(`/posts/create?${params.toString()}`);
                          }
                        }}
                      >
                        <div className="flex items-start gap-1">
                          {getStatusIcon(item.status, item.type, item.processing)}
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">
                              {item.type === 'placeholder'
                                ? '⏳ Future Post'
                                : item.caption.substring(0, 30) +
                                  (item.caption.length > 30 ? '...' : '')}
                            </div>
                            {item.processing && (
                              <div className="text-[10px] opacity-75">Scheduling...</div>
                            )}
                            {item.type === 'placeholder' && item.campaignName && (
                              <div className="text-[10px] opacity-75">{item.campaignName}</div>
                            )}
                            {item.scheduledAt && (
                              <div className="text-[10px] opacity-75">
                                {formatInTimeZone(new Date(item.scheduledAt), timezone, 'h:mm a')}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="mt-6 flex gap-4 border-t pt-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 rounded border border-green-300 bg-green-100"></div>
            <span>Published</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 rounded border border-blue-300 bg-blue-100"></div>
            <span>Scheduled</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 rounded border border-dashed border-gray-300 bg-gray-100"></div>
            <span>Future AI</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 rounded border border-red-300 bg-red-100"></div>
            <span>Failed</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
