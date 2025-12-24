import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Filter, Search, X } from 'lucide-react';
import { campaign as campaignApi, type Campaign } from '@/lib/api';
import { useCalendarFilterStore, type ContentStatus } from '@/stores/calendarFilterStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MultiSelect } from '@/components/ui/multi-select';
import { STATUS_OPTIONS } from './utils';

interface ContentFiltersBarProps {
  brandId: string;
}

export function ContentFiltersBar({ brandId }: ContentFiltersBarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const campaigns = useCalendarFilterStore((s) => s.campaigns);
  const statuses = useCalendarFilterStore((s) => s.statuses);
  const searchQuery = useCalendarFilterStore((s) => s.searchQuery);
  const setCampaigns = useCalendarFilterStore((s) => s.setCampaigns);
  const setStatuses = useCalendarFilterStore((s) => s.setStatuses);
  const setSearchQuery = useCalendarFilterStore((s) => s.setSearchQuery);

  const { data: campaignsData } = useQuery({
    queryKey: ['campaigns', brandId],
    queryFn: () => campaignApi.listCampaigns(brandId),
    staleTime: 5 * 60 * 1000,
  });

  const allCampaigns = (campaignsData?.campaigns || []) as Campaign[];

  const campaignOptions = useMemo(() => {
    return [
      { label: 'No campaign', value: 'none' },
      ...allCampaigns.map((campaign) => ({ label: campaign.name, value: campaign.id })),
    ];
  }, [allCampaigns]);

  const statusOptions = useMemo(
    () => STATUS_OPTIONS.map((option) => ({ label: option.label, value: option.value })),
    []
  );

  const hasAnyActiveFilters = campaigns.length > 0 || statuses.length > 0 || !!searchQuery;
  const activeFilterCount =
    (campaigns.length > 0 ? 1 : 0) + (statuses.length > 0 ? 1 : 0) + (searchQuery ? 1 : 0);
  const isFiltersActive = isOpen || hasAnyActiveFilters;

  const handleResetPanelFilters = () => {
    setCampaigns([]);
    setStatuses([]);
    setSearchQuery('');
  };

  return (
    <div className="relative">
      <Button
        variant={isFiltersActive ? 'default' : 'outline'}
        size="icon"
        aria-label={isFiltersActive ? 'Hide filters' : 'Show filters'}
        aria-pressed={isFiltersActive}
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative h-10 w-10"
      >
        <Filter className="h-4 w-4" />
        {hasAnyActiveFilters && (
          <span
            className={`absolute -top-1 -right-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-medium ${
              isFiltersActive
                ? 'bg-background text-foreground ring-ring ring-1'
                : 'bg-foreground text-background'
            }`}
          >
            {activeFilterCount}
          </span>
        )}
      </Button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} aria-hidden="true" />

          <div className="bg-background absolute top-12 right-0 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-lg border p-4 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold">Filter Content</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsOpen(false)}
                className="h-6 w-6 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-6">
              <div className="relative">
                <Label className="sr-only">Search</Label>
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search captions, hashtags, or campaigns"
                  className="pr-10 pl-9"
                />
                {searchQuery && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setSearchQuery('')}
                    className="absolute top-1/2 right-2 h-7 w-7 -translate-y-1/2 p-0"
                    aria-label="Clear search"
                  >
                    <X className="text-muted-foreground hover:text-foreground h-4 w-4" />
                  </Button>
                )}
              </div>

              <div>
                <Label className="mb-2 block text-sm font-medium">Campaigns</Label>
                <MultiSelect
                  options={campaignOptions}
                  value={campaigns}
                  onChange={setCampaigns}
                  placeholder="All campaigns"
                />
              </div>

              <div>
                <Label className="mb-2 block text-sm font-medium">Status</Label>
                <MultiSelect
                  options={statusOptions}
                  value={statuses}
                  onChange={(value) => setStatuses(value as ContentStatus[])}
                  placeholder="All statuses"
                />
              </div>
            </div>

            <div className="mt-6 flex gap-2 border-t pt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetPanelFilters}
                className="flex-1"
                disabled={!hasAnyActiveFilters}
              >
                Reset Filters
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => setIsOpen(false)}
                className="flex-1"
              >
                Apply
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
