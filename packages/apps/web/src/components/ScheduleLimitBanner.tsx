import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { campaign as campaignApi } from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertTriangle, X } from 'lucide-react';

export function ScheduleLimitBanner() {
  const [dismissed, setDismissed] = useState(false);

  const limitsQuery = useQuery({
    queryKey: ['limits', 'schedule-ahead'],
    queryFn: () => campaignApi.getScheduleAheadLimit(),
    staleTime: 60 * 1000,
  });

  const limits = limitsQuery.data?.data as
    | { tier: string; maxAllowed: number; currentCount: number }
    | undefined;

  const atCapacity =
    !!limits && Number.isFinite(limits.maxAllowed) && limits.currentCount >= limits.maxAllowed;

  if (!atCapacity || dismissed) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/20">
      <Alert className="mx-auto flex max-w-7xl items-center justify-between border-amber-200 bg-transparent">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <AlertDescription className="flex w-full items-center justify-between gap-3 pl-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-amber-900 dark:text-amber-200">
              You've reached your plan's scheduling limit
            </span>
            {limits && (
              <span className="text-amber-800 dark:text-amber-300">
                {limits.currentCount}/{limits.maxAllowed} scheduled ahead
              </span>
            )}
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => (window.location.href = '/settings')}
              className="border-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30"
            >
              Upgrade
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Dismiss banner"
              onClick={() => setDismissed(true)}
              className="h-7 w-7 p-1 hover:bg-amber-100 dark:hover:bg-amber-900/30"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}
