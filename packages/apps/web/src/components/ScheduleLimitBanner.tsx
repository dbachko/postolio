import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { campaign as campaignApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { AlertTriangle, X } from 'lucide-react';

const DISMISS_TTL_DAYS = 7;
const DISMISS_KEY = 'schedule-limit-banner-dismissed-at';

export function ScheduleLimitBanner() {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      if (!raw) return false;
      const ts = Number(raw);
      if (!Number.isFinite(ts)) return false;
      const ageMs = Date.now() - ts;
      return ageMs < DISMISS_TTL_DAYS * 24 * 60 * 60 * 1000;
    } catch {
      return false;
    }
  });

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
    <div className="bg-muted border-b shadow-sm">
      {/* Match AppLayout nav container sizing (height + paddings) */}
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="text-foreground flex min-w-0 items-center gap-2">
          <AlertTriangle className="text-foreground h-4 w-4 flex-shrink-0" />
          <span className="truncate text-sm font-medium">
            You've reached your plan's scheduling limit
          </span>
          {/* Counts intentionally hidden to reduce noise per design */}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => (window.location.href = '/limits')}
            className="h-9"
          >
            Learn More
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Dismiss banner"
            onClick={() => {
              try {
                localStorage.setItem(DISMISS_KEY, String(Date.now()));
              } catch (_e) {
                // noop: best-effort persistence only
                void 0;
              }
              setDismissed(true);
            }}
            className="hover:bg-accent h-9 w-9 p-2"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
