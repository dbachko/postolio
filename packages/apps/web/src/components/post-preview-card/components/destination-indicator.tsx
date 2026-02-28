import { useMemo } from 'react';
import { Layers } from 'lucide-react';

import type { SocialAccountsById } from '@/types/social-accounts';
import type { CalendarItem } from '@/types/calendar';
import { type Platform, getPlatformConfig } from '@/lib/platform-config';
import { getPlatformIcon } from '@/components/icons/platform-icons';
import { cn } from '@/lib/utils';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SocialAccountAvatar } from '@/components/social/social-account-avatar';
import { Button } from '@/components/ui/button';

type DestinationMeta = {
  id: string;
  label: string;
  platform: Platform;
  avatarName: string;
  avatarUrl: string | null;
  disconnected: boolean;
};

function getDestinationIds(item: CalendarItem): string[] {
  const record = item as unknown as Record<string, unknown>;
  const rawIds = Array.isArray(record.destinationSocialAccountIds)
    ? (record.destinationSocialAccountIds as unknown[])
    : null;
  const singleId =
    typeof record.targetSocialAccountId === 'string' ? record.targetSocialAccountId : null;

  let destinationIds: unknown[] = [];
  if (rawIds && rawIds.length > 0) {
    destinationIds = rawIds;
  } else if (singleId) {
    destinationIds = [singleId];
  }
  return Array.from(
    new Set(
      destinationIds
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  );
}

function resolveDestinations(
  item: CalendarItem,
  socialAccountsById: SocialAccountsById
): DestinationMeta[] {
  return getDestinationIds(item)
    .map((id) => {
      const meta = socialAccountsById[id];
      if (!meta) {
        return null;
      }
      return {
        id,
        label: meta.label,
        platform: meta.platform,
        avatarName: meta.avatarName,
        avatarUrl: meta.avatarUrl,
        disconnected: meta.disconnected,
      } satisfies DestinationMeta;
    })
    .filter((destination): destination is DestinationMeta => destination !== null);
}

function getPlatformIconColor(platform: Platform): string {
  const platformColor = getPlatformConfig(platform).color;
  return platformColor.trim().toLowerCase() === '#000000'
    ? 'hsl(var(--foreground))'
    : platformColor;
}

function SingleDestinationIcon({ destination }: { destination: DestinationMeta }) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center',
        destination.disconnected ? 'opacity-50 grayscale' : null
      )}
      style={{ color: getPlatformIconColor(destination.platform) }}
    >
      {getPlatformIcon(destination.platform, 'h-3 w-3')}
    </span>
  );
}

export function DestinationIndicator({
  item,
  socialAccountsById,
  hideDestinations = false,
}: {
  item: CalendarItem;
  socialAccountsById?: SocialAccountsById;
  hideDestinations?: boolean;
}) {
  const destinations = useMemo(() => {
    if (!socialAccountsById) {
      return [];
    }
    return resolveDestinations(item, socialAccountsById);
  }, [item, socialAccountsById]);

  if (hideDestinations || item.type === 'placeholder' || destinations.length === 0) {
    return null;
  }

  const destinationCount = destinations.length;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={
              destinationCount === 1 ? 'Destination' : `Destinations (${destinationCount})`
            }
            className="bg-background/60 hover:bg-muted/60 relative h-6 w-6 rounded-md backdrop-blur-sm"
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {destinationCount === 1 ? (
              <SingleDestinationIcon destination={destinations[0]!} />
            ) : (
              <>
                <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="bg-background border-border text-foreground absolute -top-1 -right-1 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full border px-1 text-[9px] leading-none tabular-nums">
                  {destinationCount}
                </span>
              </>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <div className="space-y-1.5">
            {destinations.map((destination) => (
              <div key={destination.id} className="flex items-center gap-2">
                <SocialAccountAvatar
                  platform={destination.platform}
                  name={destination.avatarName || destination.label}
                  src={destination.avatarUrl}
                  size="xs"
                  disabled={destination.disconnected}
                  muted={false}
                />
                <div className="min-w-0">
                  <div className="text-foreground truncate text-[11px] font-medium">
                    {destination.label}
                  </div>
                  {destination.disconnected ? (
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
}
