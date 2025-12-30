import { useMemo } from 'react';

import type { CalendarItem } from '@/types/calendar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export function CampaignDotIndicator({
  item,
  onOpenCampaign,
}: {
  item: CalendarItem;
  onOpenCampaign: (campaignId: string) => void;
}) {
  return useMemo(() => {
    if (item.type === 'placeholder') return null;
    const record = item as unknown as Record<string, unknown>;

    const campaignId =
      typeof record.campaignId === 'string' && record.campaignId.trim().length > 0
        ? record.campaignId.trim()
        : null;
    const campaignName =
      typeof record.campaignName === 'string' && record.campaignName.trim().length > 0
        ? record.campaignName.trim()
        : null;
    const campaignColor =
      typeof record.campaignColor === 'string' && record.campaignColor.trim().length > 0
        ? record.campaignColor.trim()
        : null;

    if (!campaignId || !campaignName || !campaignColor) return null;

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="button"
              aria-label={`Open campaign ${campaignName}`}
              className="border-border inline-flex h-3 w-3 shrink-0 cursor-pointer rounded-full border"
              style={{ backgroundColor: campaignColor }}
              onClick={(e) => {
                e.stopPropagation();
                onOpenCampaign(campaignId);
              }}
            />
          </TooltipTrigger>
          <TooltipContent>
            <span className="text-foreground text-[11px] font-medium">{campaignName}</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }, [item, onOpenCampaign]);
}
