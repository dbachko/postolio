import { memo } from 'react';
import { useCalendarFilterStore } from '../../../stores/calendarFilterStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { STATUS_OPTIONS, CONTENT_TYPE_OPTIONS, formatDateRange } from './utils';
import type { Campaign } from '../../../lib/api';

interface ActiveFiltersProps {
  allCampaigns: Campaign[];
}

export const ActiveFilters = memo(({ allCampaigns }: ActiveFiltersProps) => {
  const select = useShallow((s: any) => ({
    campaigns: s.campaigns,
    statuses: s.statuses,
    contentTypes: s.contentTypes,
    dateRange: s.dateRange,
    searchQuery: s.searchQuery,
    setCampaigns: s.setCampaigns,
    toggleStatus: s.toggleStatus,
    toggleContentType: s.toggleContentType,
    setDateRange: s.setDateRange,
    setSearchQuery: s.setSearchQuery,
  }));
  const {
    campaigns,
    statuses,
    contentTypes,
    dateRange,
    searchQuery,
    setCampaigns,
    toggleStatus,
    toggleContentType,
    setDateRange,
    setSearchQuery,
  } = useCalendarFilterStore(select);

  const activeFilterCount =
    (campaigns.length > 0 ? 1 : 0) +
    (statuses.length > 0 ? 1 : 0) +
    (contentTypes.length !== 2 ? 1 : 0) +
    (dateRange.start || dateRange.end ? 1 : 0) +
    (searchQuery ? 1 : 0);

  if (activeFilterCount === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 border-t pt-2">
      {campaigns
        .filter((id: string) => id !== 'none')
        .map((campaignId: string) => {
          const campaign = allCampaigns.find((c) => c.id === campaignId);
          return campaign ? (
            <Badge
              key={campaignId}
              className="border"
              style={{
                backgroundColor: (campaign as any).color || 'var(--muted)',
                color: '#fff',
              }}
            >
              {campaign.name}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCampaigns(campaigns.filter((id: string) => id !== campaignId))}
                className="ml-1 h-5 w-5 p-0"
                aria-label="Remove campaign filter"
              >
                <X className="h-3 w-3" />
              </Button>
            </Badge>
          ) : null;
        })}
      {campaigns.includes('none') && (
        <Badge variant="secondary">
          No campaign
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCampaigns(campaigns.filter((id: string) => id !== 'none'))}
            className="ml-1 h-5 w-5 p-0"
            aria-label="Remove no campaign filter"
          >
            <X className="h-3 w-3" />
          </Button>
        </Badge>
      )}

      {statuses.map((status: string) => {
        const opt = STATUS_OPTIONS.find((s) => s.value === status)!;
        return (
          <Badge key={status} variant={opt.variant}>
            {opt.label}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => toggleStatus(status as any)}
              className="ml-1 h-5 w-5 p-0"
              aria-label="Remove status filter"
            >
              <X className="h-3 w-3" />
            </Button>
          </Badge>
        );
      })}

      {contentTypes.length === 1 && (
        <Badge variant="secondary">
          Type: {CONTENT_TYPE_OPTIONS.find((t) => t.value === contentTypes[0])?.label}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => toggleContentType(contentTypes[0])}
            className="ml-1 h-5 w-5 p-0"
            aria-label="Remove content type filter"
          >
            <X className="h-3 w-3" />
          </Button>
        </Badge>
      )}

      {(dateRange.start || dateRange.end) && (
        <Badge variant="secondary">
          {formatDateRange(dateRange.start, dateRange.end)}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDateRange(null, null)}
            className="ml-1 h-5 w-5 p-0"
            aria-label="Remove date range filter"
          >
            <X className="h-3 w-3" />
          </Button>
        </Badge>
      )}

      {searchQuery && (
        <Badge variant="secondary">
          Search: "{searchQuery}"
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSearchQuery('')}
            className="ml-1 h-5 w-5 p-0"
            aria-label="Remove search filter"
          >
            <X className="h-3 w-3" />
          </Button>
        </Badge>
      )}
    </div>
  );
});
