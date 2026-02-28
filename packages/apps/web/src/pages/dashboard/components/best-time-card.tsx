import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { BestTimePayload } from '@/lib/api/types';
import { formatInUserTimezone } from '@/lib/timezone';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

type BestTimeCardProps = {
  bestTime: BestTimePayload | undefined;
  isLoading: boolean;
  isError: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
  brandTimezone?: string;
};

export function BestTimeCard({
  bestTime,
  isLoading,
  isError,
  onRefresh,
  isRefreshing,
  brandTimezone,
}: BestTimeCardProps) {
  let body: ReactNode;
  if (isLoading) {
    body = (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-md border p-3">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    );
  } else if (isError || !bestTime) {
    body = (
      <p className="text-muted-foreground text-sm">Recommendations are unavailable right now.</p>
    );
  } else {
    body = (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">
            {bestTime.source || 'unknown'} • {Math.round((bestTime.confidence || 0) * 100)}%
          </Badge>
        </div>
        {bestTime.topWindows?.slice(0, 3).map((win) => (
          <div key={win.startUTC} className="space-y-1 rounded-md border p-3">
            <div className="text-sm font-medium">
              {formatInUserTimezone(win.startUTC, 'EEE • h:mm a', brandTimezone)}
            </div>
            <div className="text-muted-foreground text-xs">
              {win.explanation || 'Recommended window'} • {Math.round(win.score * 100)} score
            </div>
          </div>
        ))}
        <Button asChild variant="ghost" size="sm" className="w-full justify-between">
          <Link to="/analytics">
            Improve performance <span aria-hidden="true">→</span>
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <Card className="lg:col-span-1">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle>Best time to post</CardTitle>
          <p className="text-muted-foreground text-sm">AI-powered timing suggestions.</p>
        </div>
        <Button size="sm" variant="outline" onClick={onRefresh} disabled={isRefreshing}>
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">{body}</CardContent>
    </Card>
  );
}
