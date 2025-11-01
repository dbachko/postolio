import { memo, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCalendarFilterStore } from '../../../stores/calendarFilterStore';
import { campaign as campaignApi, type Campaign } from '../../../lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Filter } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { CampaignFilter } from './CampaignFilter';
import { StatusFilter } from './StatusFilter';
import { ContentTypeFilter } from './ContentTypeFilter';
import { DateRangeFilter } from './DateRangeFilter';
import { SearchFilter } from './SearchFilter';
import { ActiveFilters } from './ActiveFilters';

interface CalendarFiltersProps {
  brandId: string;
  compact?: boolean;
}

export const CalendarFilters = memo(({ brandId, compact = false }: CalendarFiltersProps) => {
  const select = useShallow((s: any) => ({
    campaigns: s.campaigns,
    statuses: s.statuses,
    contentTypes: s.contentTypes,
    dateRange: s.dateRange,
    searchQuery: s.searchQuery,
  }));
  const { campaigns, statuses, contentTypes, dateRange, searchQuery } =
    useCalendarFilterStore(select);
  const clearAll = useCalendarFilterStore((s) => s.clearAll);

  const { data: campaignsData } = useQuery({
    queryKey: ['campaigns', brandId],
    queryFn: () => campaignApi.listCampaigns(brandId),
    staleTime: 5 * 60 * 1000,
  });

  const allCampaigns = (campaignsData?.campaigns || []) as Campaign[];

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (campaigns.length > 0) count++;
    if (statuses.length > 0) count++;
    if (contentTypes.length !== 2) count++;
    if (dateRange.start || dateRange.end) count++;
    if (searchQuery.length > 0) count++;
    return count;
  }, [campaigns, statuses, contentTypes, dateRange, searchQuery]);

  return (
    <div className={`space-y-3 rounded-lg border ${compact ? 'p-2' : 'p-4'}`}>
      {!compact && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4" />
            <span className="font-medium">Filters</span>
            {activeFilterCount > 0 && <Badge variant="secondary">{activeFilterCount} active</Badge>}
          </div>
          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              Clear All
            </Button>
          )}
        </div>
      )}

      <div
        className={`grid grid-cols-1 ${compact ? 'gap-2' : 'gap-4'} md:grid-cols-2 lg:grid-cols-4`}
      >
        <CampaignFilter brandId={brandId} compact={compact} />
        <StatusFilter compact={compact} />
        <ContentTypeFilter compact={compact} />
        <DateRangeFilter compact={compact} />
      </div>

      <SearchFilter compact={compact} />

      <ActiveFilters allCampaigns={allCampaigns} />
    </div>
  );
});
