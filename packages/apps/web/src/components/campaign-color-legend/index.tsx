import { useMemo } from 'react';
import type { CalendarItem } from '@/types/calendar';

interface CampaignColorLegendProps {
  items: CalendarItem[];
  className?: string;
}

export function CampaignColorLegend({ items, className = '' }: CampaignColorLegendProps) {
  // Extract unique campaigns with colors
  const campaigns = useMemo(() => {
    const campaignMap = new Map<
      string,
      { id: string; name: string; color: string; count: number }
    >();

    items.forEach((item) => {
      const campaignId = item.campaignId;
      const campaignName = item.campaignName || 'Unknown Campaign';
      const campaignColor = item.campaignColor;

      if (!campaignId || !campaignColor) return;

      if (campaignMap.has(campaignId)) {
        const existing = campaignMap.get(campaignId)!;
        existing.count++;
      } else {
        campaignMap.set(campaignId, {
          id: campaignId,
          name: campaignName,
          color: campaignColor,
          count: 1,
        });
      }
    });

    return Array.from(campaignMap.values()).sort((a, b) => b.count - a.count);
  }, [items]);

  if (campaigns.length === 0) {
    return null;
  }

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <span className="text-muted-foreground text-xs font-medium">Campaigns:</span>
      {campaigns.map((campaign) => (
        <div
          key={campaign.id}
          className="bg-card flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-shadow hover:shadow-sm"
          style={{ borderColor: campaign.color }}
        >
          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: campaign.color }} />
          <span className="text-foreground font-medium">{campaign.name}</span>
          <span className="text-muted-foreground">({campaign.count})</span>
        </div>
      ))}
    </div>
  );
}
