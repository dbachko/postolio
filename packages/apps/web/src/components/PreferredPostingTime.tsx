import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useInstagramBestTime,
  useInstagramBestTimeStatus,
  useRefreshInstagramBestTime,
} from '@/hooks/useBestTime';
import type { BestTimePayload } from '@/lib/api/types';

function Heatmap({ heatmap }: { heatmap: BestTimePayload['heatmap'] }) {
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
            {row.map((value, hourIndex) => (
              <div
                key={hourIndex}
                className="border-border bg-muted h-4 w-full rounded-[2px] border"
                style={{ opacity: 0.18 + Math.min(1, Math.max(0, value)) * 0.6 }}
                title={`${String(hourIndex).padStart(2, '0')}:00 • score ${value.toFixed(2)}`}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="text-muted-foreground mt-1 text-xs">0 → 23h (local time)</div>
    </div>
  );
}

function TopWindows({ data }: { data: BestTimePayload }) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fmtDay = new Intl.DateTimeFormat('en-US', { timeZone: data.timezone, weekday: 'short' });
  const fmtDateTime = new Intl.DateTimeFormat('en-US', {
    timeZone: data.timezone,
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
  });
  const fmtTimeOnly = new Intl.DateTimeFormat('en-US', {
    timeZone: data.timezone,
    hour: 'numeric',
    minute: '2-digit',
  });

  const grouped = data.topWindows
    .slice()
    .sort((a, b) => b.score - a.score)
    .reduce<Record<number, BestTimePayload['topWindows']>>((acc, window) => {
      const dayLabel = fmtDay.format(new Date(window.startUTC));
      const dayIndex = days.indexOf(dayLabel);
      const idx = dayIndex >= 0 ? dayIndex : 0;
      acc[idx] = acc[idx] || [];
      acc[idx].push(window);
      return acc;
    }, {});

  return (
    <div className="space-y-2">
      {days.map((label, dayIndex) => {
        const items = grouped[dayIndex] || [];
        if (!items.length) return null;
        return (
          <div key={label} className="space-y-2">
            <div className="text-muted-foreground text-xs">{label}</div>
            {items.map((window, idx) => {
              const start = new Date(window.startUTC);
              const end = new Date(start.getTime() + window.durationMinutes * 60 * 1000);
              return (
                <div
                  key={`${dayIndex}-${idx}`}
                  className="flex items-center justify-between rounded-md border p-2"
                >
                  <div className="space-y-1">
                    <div className="text-sm font-medium">
                      {fmtDateTime.format(start)}–{fmtTimeOnly.format(end)}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {window.durationMinutes} min window · score {window.score.toFixed(2)} · source{' '}
                      {data.source}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline">
                      Use This Time
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
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
            <Skeleton className="h-24 w-full" />
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          </div>
        )}
        {isError && (
          <div className="text-muted-foreground">
            Connect a social media account to enable personalized posting time recommendations.
          </div>
        )}
        {!isLoading && !isError && data && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <div className="text-sm font-medium">Weekly Heatmap</div>
              <div className="text-muted-foreground mb-2 text-xs">
                Local timezone: {data.timezone} · Generated{' '}
                {new Date(data.generatedAt).toLocaleString()}
              </div>
              <Heatmap heatmap={data.heatmap} />
            </div>
            <div>
              <div className="text-sm font-medium">Top Time Windows</div>
              <div className="text-muted-foreground mb-2 text-xs">
                Highlights of the best {data.topWindows?.[0]?.durationMinutes ?? 30}‑minute windows
              </div>
              <TopWindows data={data} />
            </div>
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
