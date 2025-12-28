import { useMemo } from 'react';
import type { CalendarItem } from '@/types/calendar';

const str = (v: unknown) => (typeof v === 'string' && v.trim()) || null;

/**
 * Lightweight campaign dot without tooltip.
 * Used for initial render before user interaction.
 */
export function CampaignDotLight({ item }: { item: CalendarItem }) {
  return useMemo(() => {
    if (item.type === 'placeholder') return null;
    const record = item as unknown as Record<string, unknown>;

    const campaignId = str(record.campaignId);
    const campaignName = str(record.campaignName);
    const campaignColor = str(record.campaignColor);

    if (!campaignId || !campaignName || !campaignColor) return null;

    return (
      <span
        aria-label={`Campaign: ${campaignName}`}
        className="border-border inline-flex h-3 w-3 shrink-0 rounded-full border"
        style={{ backgroundColor: campaignColor }}
      />
    );
  }, [item]);
}
