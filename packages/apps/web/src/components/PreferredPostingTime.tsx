import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useInstagramBestTime,
  useInstagramBestTimeStatus,
  useRefreshInstagramBestTime,
} from '@/hooks/useBestTime';
import type { BestTimePayload } from '@/lib/api/types';
import { cn } from '@/lib/utils';

type HighlightCell = {
  title: string;
};

function getHighlightCells(data: BestTimePayload): Record<string, HighlightCell[]> {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const fmtLocal = new Intl.DateTimeFormat('en-US', {
    timeZone: data.timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const fmtTimeOnly = new Intl.DateTimeFormat('en-US', {
    timeZone: data.timezone,
    hour: 'numeric',
    minute: '2-digit',
  });

  const getLocalParts = (date: Date) => {
    const parts = fmtLocal.formatToParts(date);
    const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    const dayIndex = Math.max(0, days.indexOf(weekday));
    return { dayIndex, hour, minute, weekday };
  };

  const windowsByDay = data.topWindows.reduce<Record<number, BestTimePayload['topWindows']>>(
    (acc, window) => {
      const start = new Date(window.startUTC);
      const { dayIndex } = getLocalParts(start);
      acc[dayIndex] = acc[dayIndex] || [];
      acc[dayIndex].push(window);
      return acc;
    },
    {}
  );

  const byCell: Record<string, HighlightCell[]> = {};

  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const topTwo = (windowsByDay[dayIndex] || [])
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    for (const window of topTwo) {
      const start = new Date(window.startUTC);
      const end = new Date(start.getTime() + window.durationMinutes * 60 * 1000);
      const midpoint = new Date(start.getTime() + (window.durationMinutes * 60 * 1000) / 2);

      const mid = getLocalParts(midpoint);
      const cellKey = `${mid.dayIndex}-${mid.hour}`;
      const title = `${mid.weekday} • ${fmtTimeOnly.format(start)}–${fmtTimeOnly.format(end)} • score ${window.score.toFixed(2)}`;

      byCell[cellKey] = byCell[cellKey] || [];
      byCell[cellKey].push({ title });
    }
  }

  return byCell;
}

function Heatmap({
  heatmap,
  highlightCells,
}: {
  heatmap: BestTimePayload['heatmap'];
  highlightCells: Record<string, HighlightCell[]>;
}) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return (
    <div className="space-y-2">
      {heatmap.map((row, dayIndex) => (
        <div key={dayIndex} className="flex items-center gap-2">
          <div className="text-muted-foreground w-10 text-xs">{days[dayIndex]}</div>
          <div
            className="grid flex-1 gap-[2px]"
            style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}
          >
            {row.map((value, hourIndex) => {
              const cellKey = `${dayIndex}-${hourIndex}`;
              const highlights = highlightCells[cellKey] || [];
              const isHighlighted = highlights.length > 0;
              const title = [
                `${String(hourIndex).padStart(2, '0')}:00 • score ${value.toFixed(2)}`,
                ...highlights.map((h) => `Top window: ${h.title}`),
              ].join('\n');

              return (
                <div
                  key={hourIndex}
                  className={cn(
                    'border-border bg-muted h-4 w-full rounded-[2px] border',
                    isHighlighted &&
                      'border-primary ring-primary ring-offset-background ring-2 ring-offset-1'
                  )}
                  style={{ opacity: 0.18 + Math.min(1, Math.max(0, value)) * 0.6 }}
                  title={title}
                />
              );
            })}
          </div>
        </div>
      ))}
      <div className="text-muted-foreground mt-1 text-xs">0 → 23h (local time)</div>
    </div>
  );
}

export function PreferredPostingTime({ brandId }: { brandId: string }) {
  const { data, isLoading, isError } = useInstagramBestTime(brandId);
  const status = useInstagramBestTimeStatus(brandId);
  const refresh = useRefreshInstagramBestTime(brandId);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Preferred Posting Times</CardTitle>
          <div className="flex items-center gap-2">
            {status.data?.cached && (
              <div className="text-muted-foreground text-xs">
                Confidence {Math.round((status.data.confidence ?? 0) * 100)}% · Source{' '}
                {status.data.source}
              </div>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
            >
              {refresh.isPending ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
          </div>
        )}
        {isError && (
          <div className="text-muted-foreground">
            Connect a social media account to enable personalized posting time recommendations.
          </div>
        )}
        {!isLoading && !isError && data && (
          <div>
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Weekly Heatmap</div>
                <div className="text-muted-foreground mb-2 text-xs">
                  Local timezone: {data.timezone} · Generated{' '}
                  {new Date(data.generatedAt).toLocaleString()}
                </div>
              </div>
              <div className="text-muted-foreground text-xs">Top 2 windows/day highlighted</div>
            </div>
            <Heatmap heatmap={data.heatmap} highlightCells={getHighlightCells(data)} />
          </div>
        )}
        {!isLoading && !isError && !data && (
          <div className="text-muted-foreground">
            No data yet. Connect a social media account and try Refresh.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default PreferredPostingTime;
