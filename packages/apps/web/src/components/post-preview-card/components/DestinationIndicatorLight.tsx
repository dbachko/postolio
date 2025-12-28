import { useMemo } from 'react';
import { Layers } from 'lucide-react';
import type { CalendarItem } from '@/types/calendar';
import type { SocialAccountsById } from '@/types/social-accounts';
import type { Platform } from '@/lib/platform-config';
import { getPlatformConfig } from '@/lib/platform-config';
import { getPlatformIcon } from '@/lib/platform-icons';
import { cn } from '@/lib/utils';

/**
 * Lightweight destination indicator without tooltip.
 * Used for initial render before user interaction.
 */
export function DestinationIndicatorLight({
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
      platform: Platform;
      disconnected: boolean;
    }> = [];
    for (const id of unique) {
      const meta = socialAccountsById[id];
      if (!meta) continue;
      destinations.push({
        id,
        platform: meta.platform,
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

    return (
      <span
        aria-label={destinationCount === 1 ? 'Destination' : `${destinationCount} destinations`}
        className="bg-background/60 relative inline-flex h-6 w-6 items-center justify-center rounded-md backdrop-blur-sm"
      >
        {destinationCount === 1 ? (
          platformChipIcon(destinations[0]!)
        ) : (
          <>
            <Layers className="text-muted-foreground h-3.5 w-3.5" aria-hidden="true" />
            <span className="bg-background border-border text-foreground absolute -top-1 -right-1 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full border px-1 text-[9px] leading-none tabular-nums">
              {destinationCount}
            </span>
          </>
        )}
      </span>
    );
  }, [hideDestinations, item, socialAccountsById]);
}
