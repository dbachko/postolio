import { useMemo } from 'react';

import type { CalendarItem } from '@/types/calendar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export function SeriesIndicator({ item }: { item: CalendarItem }) {
  return useMemo(() => {
    if (item.type === 'placeholder') {
      return null;
    }
    const record = item as unknown as Record<string, unknown>;

    const seriesId =
      typeof record.contentSeriesId === 'string' && record.contentSeriesId.trim().length > 0
        ? record.contentSeriesId.trim()
        : null;
    const seriesName =
      typeof record.contentSeriesName === 'string' && record.contentSeriesName.trim().length > 0
        ? record.contentSeriesName.trim()
        : null;
    const seriesColor =
      typeof record.contentSeriesColor === 'string' && record.contentSeriesColor.trim().length > 0
        ? record.contentSeriesColor.trim()
        : null;

    if (!seriesId || !seriesName || !seriesColor) {
      return null;
    }

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              aria-label={`Series: ${seriesName}`}
              className="border-border inline-flex h-3 w-3 shrink-0 rounded-full border"
              style={{ backgroundColor: seriesColor }}
            />
          </TooltipTrigger>
          <TooltipContent>
            <span className="text-foreground text-[11px] font-medium">{seriesName}</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }, [item]);
}
