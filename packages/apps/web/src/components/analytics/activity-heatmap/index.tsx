import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Clock } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatNumber } from '@/utils/formatNumber';

interface ActivityHeatmapProps {
  heatmap: number[][]; // 7 days × 24 hours
  bestTimes?: Array<{
    day: number;
    dayName: string;
    hour: number;
    timeFormatted: string;
    avgEngagement: number;
  }>;
  loading?: boolean;
}

export function ActivityHeatmap({ heatmap, bestTimes, loading }: ActivityHeatmapProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            <span>Best Posting Times</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!heatmap || heatmap.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            <span>Best Posting Times</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground py-8 text-center">
            <Clock className="mx-auto mb-3 h-12 w-12 opacity-30" />
            <p className="text-sm">Not enough data yet</p>
            <p className="text-xs">Publish more posts to see optimal posting times</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Find max value for color scaling
  const maxValue = Math.max(...heatmap.flat());

  // Get color intensity based on value
  const getColor = (value: number) => {
    if (value === 0) {
      return 'bg-muted';
    }
    const intensity = Math.min(1, value / maxValue);
    if (intensity > 0.8) {
      return 'bg-green-500 dark:bg-green-600';
    }
    if (intensity > 0.6) {
      return 'bg-green-400 dark:bg-green-700';
    }
    if (intensity > 0.4) {
      return 'bg-green-300 dark:bg-green-800';
    }
    if (intensity > 0.2) {
      return 'bg-green-200 dark:bg-green-900';
    }
    return 'bg-green-100 dark:bg-green-950';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          <span>Best Posting Times</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Best Times Summary */}
        {bestTimes && bestTimes.length > 0 && (
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="mb-2 text-sm font-medium">Top Posting Times:</div>
            <div className="flex flex-wrap gap-2">
              {bestTimes.map((time, idx) => (
                <div
                  key={idx}
                  className="bg-background flex items-center gap-2 rounded-md px-3 py-1.5 text-xs"
                >
                  <span className="font-medium">{time.dayName}</span>
                  <span className="text-muted-foreground">{time.timeFormatted}</span>
                  <span className="text-green-600 dark:text-green-400">
                    {formatNumber(time.avgEngagement)} avg engagement
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Heatmap Grid */}
        <div className="overflow-x-auto">
          <div className="inline-block min-w-full">
            <div className="grid gap-1" style={{ gridTemplateColumns: 'auto repeat(24, 1fr)' }}>
              {/* Hour headers */}
              <div></div>
              {Array.from({ length: 24 }, (_, i) => (
                <div key={i} className="text-muted-foreground text-center text-xs">
                  {i % 3 === 0 ? i : ''}
                </div>
              ))}

              {/* Heatmap cells */}
              {heatmap.map((dayData, dayIndex) => (
                <>
                  {/* Day label */}
                  <div
                    key={`day-${dayIndex}`}
                    className="text-muted-foreground flex items-center pr-2 text-xs font-medium"
                  >
                    {days[dayIndex]}
                  </div>

                  {/* Hour cells */}
                  {dayData.map((value, hourIndex) => (
                    <TooltipProvider key={`${dayIndex}-${hourIndex}`}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className={`hover:ring-primary h-6 w-full rounded-sm transition-colors hover:ring-2 ${getColor(value)}`}
                            style={{ cursor: value > 0 ? 'pointer' : 'default' }}
                          />
                        </TooltipTrigger>
                        {value > 0 && (
                          <TooltipContent>
                            <p className="text-xs">
                              {days[dayIndex]} at {hourIndex}:00
                            </p>
                            <p className="text-xs font-medium">
                              {formatNumber(value)} avg engagement
                            </p>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </TooltipProvider>
                  ))}
                </>
              ))}
            </div>

            {/* Legend */}
            <div className="text-muted-foreground mt-4 flex items-center justify-end gap-2 text-xs">
              <span>Less</span>
              <div className="flex gap-1">
                <div className="bg-muted h-4 w-4 rounded-sm"></div>
                <div className="h-4 w-4 rounded-sm bg-green-100 dark:bg-green-950"></div>
                <div className="h-4 w-4 rounded-sm bg-green-200 dark:bg-green-900"></div>
                <div className="h-4 w-4 rounded-sm bg-green-300 dark:bg-green-800"></div>
                <div className="h-4 w-4 rounded-sm bg-green-400 dark:bg-green-700"></div>
                <div className="h-4 w-4 rounded-sm bg-green-500 dark:bg-green-600"></div>
              </div>
              <span>More</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
