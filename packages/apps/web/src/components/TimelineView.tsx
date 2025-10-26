import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { useTimezone } from '../contexts/TimezoneContext';
import { Card, CardContent } from '@/components/ui/card';
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
  campaignColor?: string | null;
  processing?: boolean;
}

interface TimelineViewProps {
  items: TimelineItem[];
  currentDate: Date;
  timezone?: string; // brand posting timezone override
}

export function TimelineView({ items, currentDate, timezone: tzOverride }: TimelineViewProps) {
  const navigate = useNavigate();
  const { timezone: ctxTz } = useTimezone();
  const timezone = tzOverride || ctxTz;

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
  }, [items, weekDays, timezone]);

  const getStatusColor = (_status: string, type: string, processing?: boolean) => {
    if (type === 'placeholder') return 'bg-muted text-muted-foreground border';
    if (processing) return 'bg-muted text-foreground border';
    return 'bg-muted text-foreground border';
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
          <div className="text-muted-foreground grid grid-cols-8 gap-4 border-b pb-2 text-sm font-medium">
            <div className="col-span-1">Time</div>
            {weekDays.map((day) => (
              <div
                key={day.toISOString()}
                className={`text-center ${isSameDay(day, new Date()) ? 'text-foreground font-bold' : ''}`}
              >
                <div>{format(day, 'EEE')}</div>
                <div className="text-xs">{format(day, 'MMM d')}</div>
              </div>
            ))}
          </div>

          {/* Timeline content by hour */}
          {Array.from({ length: 24 }, (_, hour) => (
            <div key={hour} className="grid min-h-[60px] grid-cols-8 gap-4">
              <div className="text-muted-foreground col-span-1 pt-1 text-sm">
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
                  <div key={`${dayKey}-${hour}`} className="border-border relative border-l">
                    {hourItems.map((item, idx) => (
                      <div
                        key={item.id}
                        className={`absolute left-0 right-0 mx-1 rounded p-2 text-xs ${
                          item.type === 'placeholder'
                            ? 'border border-dashed'
                            : 'cursor-pointer border transition-shadow hover:shadow-md'
                        } ${getStatusColor(item.status, item.type, item.processing)}`}
                        style={{
                          top: `${idx * 25}px`,
                          ...(item.campaignColor
                            ? (() => {
                                const color = item.campaignColor;
                                const isHex = /^#([0-9A-F]{6})$/i.test(color);
                                return {
                                  borderLeftWidth: '4px',
                                  borderLeftStyle: 'solid',
                                  borderLeftColor: color,
                                  ...(isHex
                                    ? (() => {
                                        const r = parseInt(color.slice(1, 3), 16);
                                        const g = parseInt(color.slice(3, 5), 16);
                                        const b = parseInt(color.slice(5, 7), 16);
                                        return { backgroundColor: `rgba(${r}, ${g}, ${b}, 0.08)` };
                                      })()
                                    : {}),
                                } as React.CSSProperties;
                              })()
                            : {}),
                        }}
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
            <div className="bg-muted h-4 w-4 rounded border"></div>
            <span>Published</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="bg-muted h-4 w-4 rounded border"></div>
            <span>Scheduled</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="bg-muted h-4 w-4 rounded border border-dashed"></div>
            <span>Future AI</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="bg-muted h-4 w-4 rounded border"></div>
            <span>Failed</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
