import type { ReactNode } from 'react';
import { Clock } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatNumber } from '@/utils/formatNumber';

interface ActivityHeatmapProps {
  heatmap: number[][];
  bestTimes?: Array<{
    day: number;
    dayName: string;
    hour: number;
    timeFormatted: string;
    avgEngagement: number;
  }>;
  loading?: boolean;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getHeatmapColor(value: number, maxValue: number): string {
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
}

function ActivityHeatmapCard(props: { children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          <span>Best Posting Times</span>
        </CardTitle>
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
  );
}

function BestTimesSummary(props: { bestTimes: NonNullable<ActivityHeatmapProps['bestTimes']> }) {
  return (
    <div className="bg-muted/50 rounded-lg p-4">
      <div className="mb-2 text-sm font-medium">Top Posting Times:</div>
      <div className="flex flex-wrap gap-2">
        {props.bestTimes.map((time, index) => (
          <div
            key={index}
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
  );
}

function HeatmapGrid(props: { heatmap: number[][]; maxValue: number }) {
  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        <div className="grid gap-1" style={{ gridTemplateColumns: 'auto repeat(24, 1fr)' }}>
          <div></div>
          {Array.from({ length: 24 }, (_, hour) => (
            <div key={hour} className="text-muted-foreground text-center text-xs">
              {hour % 3 === 0 ? hour : ''}
            </div>
          ))}

          {props.heatmap.map((dayData, dayIndex) => (
            <>
              <div
                key={`day-${dayIndex}`}
                className="text-muted-foreground flex items-center pr-2 text-xs font-medium"
              >
                {DAYS[dayIndex]}
              </div>
              {dayData.map((value, hourIndex) => (
                <TooltipProvider key={`${dayIndex}-${hourIndex}`}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className={`hover:ring-primary h-6 w-full rounded-sm transition-colors hover:ring-2 ${getHeatmapColor(value, props.maxValue)}`}
                        style={{ cursor: value > 0 ? 'pointer' : 'default' }}
                      />
                    </TooltipTrigger>
                    {value > 0 ? (
                      <TooltipContent>
                        <p className="text-xs">
                          {DAYS[dayIndex]} at {hourIndex}:00
                        </p>
                        <p className="text-xs font-medium">{formatNumber(value)} avg engagement</p>
                      </TooltipContent>
                    ) : null}
                  </Tooltip>
                </TooltipProvider>
              ))}
            </>
          ))}
        </div>

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
  );
}

function ActivityHeatmapContent(props: {
  heatmap: number[][];
  bestTimes?: ActivityHeatmapProps['bestTimes'];
}) {
  const maxValue = Math.max(...props.heatmap.flat());

  return (
    <div className="space-y-4">
      {props.bestTimes?.length ? <BestTimesSummary bestTimes={props.bestTimes} /> : null}
      <HeatmapGrid heatmap={props.heatmap} maxValue={maxValue} />
    </div>
  );
}

export function ActivityHeatmap({ heatmap, bestTimes, loading }: ActivityHeatmapProps) {
  if (loading) {
    return (
      <ActivityHeatmapCard>
        <Skeleton className="h-64 w-full" />
      </ActivityHeatmapCard>
    );
  }

  if (!heatmap?.length) {
    return (
      <ActivityHeatmapCard>
        <div className="text-muted-foreground py-8 text-center">
          <Clock className="mx-auto mb-3 h-12 w-12 opacity-30" />
          <p className="text-sm">Not enough data yet</p>
          <p className="text-xs">Publish more posts to see optimal posting times</p>
        </div>
      </ActivityHeatmapCard>
    );
  }

  return (
    <ActivityHeatmapCard>
      <ActivityHeatmapContent heatmap={heatmap} bestTimes={bestTimes} />
    </ActivityHeatmapCard>
  );
}
