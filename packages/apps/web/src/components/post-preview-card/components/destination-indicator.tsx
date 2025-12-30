import { useMemo } from 'react';
import { Layers } from 'lucide-react';

import type { SocialAccountsById } from '@/types/social-accounts';
import type { CalendarItem } from '@/types/calendar';
import type { Platform } from '@/lib/platform-config';
import { getPlatformConfig } from '@/lib/platform-config';
import { getPlatformIcon } from '@/lib/platform-icons';
import { cn } from '@/lib/utils';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SocialAccountAvatar } from '@/components/social/social-account-avatar';
import { Button } from '@/components/ui/button';

export function DestinationIndicator({
  item,
  socialAccountsById,
  hideDestinations = false,
}: {
  item: CalendarItem;
  socialAccountsById?: SocialAccountsById;
  hideDestinations?: boolean;
}) {
  return useMemo(() => {
    if (hideDestinations) return null;
    if (item.type === 'placeholder') return null;
    if (!socialAccountsById) return null;

    const record = item as unknown as Record<string, unknown>;
    const rawIds = Array.isArray(record.destinationSocialAccountIds)
      ? (record.destinationSocialAccountIds as unknown[])
      : null;
    const singleId =
      typeof record.targetSocialAccountId === 'string' ? record.targetSocialAccountId : null;

    const ids = (rawIds && rawIds.length > 0 ? rawIds : singleId ? [singleId] : [])
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);

    const unique = Array.from(new Set(ids));
    if (unique.length === 0) return null;

    const destinations: Array<{
      id: string;
      label: string;
      platform: Platform;
      avatarName: string;
      avatarUrl: string | null;
      disconnected: boolean;
    }> = [];
    for (const id of unique) {
      const meta = socialAccountsById[id];
      if (!meta) continue;
      destinations.push({
        id,
        label: meta.label,
        platform: meta.platform,
        avatarName: meta.avatarName,
        avatarUrl: meta.avatarUrl,
        disconnected: meta.disconnected,
      });
    }
    if (destinations.length === 0) return null;

    const destinationCount = destinations.length;

    const platformChipIcon = (dest: (typeof destinations)[number]) => {
      const platformColor = getPlatformConfig(dest.platform).color;
      const iconColor =
        platformColor.trim().toLowerCase() === '#000000' ? 'hsl(var(--foreground))' : platformColor;
      return (
        <span
          className={cn(
            'inline-flex items-center justify-center',
            dest.disconnected ? 'opacity-50 grayscale' : null
          )}
          style={{ color: iconColor }}
        >
          {getPlatformIcon(dest.platform, 'h-3 w-3')}
        </span>
      );
    };

    const chip = (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={destinationCount === 1 ? 'Destination' : `Destinations (${destinationCount})`}
        className="bg-background/60 hover:bg-muted/60 relative h-6 w-6 rounded-md backdrop-blur-sm"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {destinationCount === 1 ? (
          platformChipIcon(destinations[0]!)
        ) : (
          <>
            <Layers className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="bg-background border-border text-foreground absolute -top-1 -right-1 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full border px-1 text-[9px] leading-none tabular-nums">
              {destinationCount}
            </span>
          </>
        )}
      </Button>
    );

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{chip}</TooltipTrigger>
          <TooltipContent>
            <div className="space-y-1.5">
              {destinations.map((dest) => (
                <div key={dest.id} className="flex items-center gap-2">
                  <SocialAccountAvatar
                    platform={dest.platform}
                    name={dest.avatarName || dest.label}
                    src={dest.avatarUrl}
                    size="xs"
                    disabled={dest.disconnected}
                    muted={false}
                  />
                  <div className="min-w-0">
                    <div className="text-foreground truncate text-[11px] font-medium">
                      {dest.label}
                    </div>
                    {dest.disconnected ? (
                      <div className="text-muted-foreground text-[10px]">Disconnected</div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }, [hideDestinations, item, socialAccountsById]);
}
