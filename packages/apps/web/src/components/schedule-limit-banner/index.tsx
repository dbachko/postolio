import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { httpGet } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { getLocalSetting, setLocalSetting } from '@/lib/settings/localSettings';
import { AlertTriangle } from 'lucide-react';

const DISMISS_TTL_DAYS = 7;
const DISMISS_KEY = 'schedule-limit-banner-dismissed-at';

export function ScheduleLimitBanner() {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      const ts = getLocalSetting<number>(DISMISS_KEY);
      if (!ts || !Number.isFinite(ts)) return false;
      const ageMs = Date.now() - ts;
      return ageMs < DISMISS_TTL_DAYS * 24 * 60 * 60 * 1000;
    } catch {
      return false;
    }
  });

  const limitsQuery = useQuery({
    queryKey: ['limits', 'schedule-ahead'],
    queryFn: async () => httpGet('/api/account/limits/schedule-ahead'),
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
      <div className="flex h-14 items-center justify-between px-4 sm:px-6 lg:px-8">
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
            variant="ghost"
            size="sm"
            aria-label="Dismiss schedule limit banner"
            onClick={() => {
              try {
                setLocalSetting<number>(DISMISS_KEY, Date.now());
              } catch {}
              setDismissed(true);
            }}
            className="hover:bg-accent h-9"
          >
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}
