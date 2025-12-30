import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useNavigate } from 'react-router-dom';
import { CampaignsList } from '@/components/campaigns-list';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Campaign } from '@/lib/api';
import { useState, useMemo } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowDown, ArrowUp, Plus, Search } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';

type CampaignStatusFilter = 'all' | 'active' | 'paused' | 'completed' | 'preview';
type CampaignSortField = 'created' | 'name';
type SortDirection = 'asc' | 'desc';

interface Props {
  campaigns: Campaign[] | undefined;
  onViewCampaignDetails: (id: string) => void;
}

export function CampaignDashboard({ campaigns, onViewCampaignDetails }: Props) {
  const navigate = useNavigate();

  // Filtering and sorting
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState<CampaignStatusFilter>('all');
  const [sortField, setSortField] = useState<CampaignSortField>('created');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const search = useDebounce(searchInput, 300);

  // Filter and sort campaigns
  const filteredAndSortedCampaigns = useMemo(() => {
    if (!campaigns) return [];

    const normalizedSearch = search.trim().toLowerCase();
    let filtered = campaigns.filter((campaign) => {
      if (!normalizedSearch) return true;
      return campaign.name.toLowerCase().includes(normalizedSearch);
    });

    // Apply status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter((c) => c.status === statusFilter);
    }

    // Apply sorting
    const multiplier = sortDirection === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortField === 'name') {
        const diff = a.name.localeCompare(b.name);
        if (diff !== 0) return diff * multiplier;
        return a.id.localeCompare(b.id) * multiplier;
      }

      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      if (aTime === bTime) return a.id.localeCompare(b.id) * multiplier;
      return (aTime - bTime) * multiplier;
    });
  }, [campaigns, search, sortDirection, sortField, statusFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search campaigns"
              className="pl-9"
            />
          </div>

          <Tabs
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as CampaignStatusFilter)}
            className="shrink-0"
          >
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="paused">Paused</TabsTrigger>
              <TabsTrigger value="completed">Completed</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="flex w-full items-center sm:w-auto">
              <Select value={sortField} onValueChange={(v) => setSortField(v as CampaignSortField)}>
                <SelectTrigger className="h-10 w-full rounded-r-none sm:w-[200px]">
                  <SelectValue placeholder="Sort campaigns" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="created">Created date</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                className="h-10 rounded-l-none border-l-0"
                onClick={() => setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                aria-label={`Sort ${sortDirection === 'asc' ? 'ascending' : 'descending'}`}
              >
                {sortDirection === 'asc' ? (
                  <ArrowUp className="h-4 w-4" />
                ) : (
                  <ArrowDown className="h-4 w-4" />
                )}
              </Button>
            </div>

            <Button
              className="w-full gap-2 sm:w-auto"
              onClick={() => navigate('/campaigns/create')}
            >
              <Plus className="h-4 w-4" />
              Create Campaign
            </Button>
          </div>
        </div>
      </div>

      <CampaignsList
        campaigns={filteredAndSortedCampaigns}
        onViewCampaignDetails={onViewCampaignDetails}
      />
    </div>
  );
}
