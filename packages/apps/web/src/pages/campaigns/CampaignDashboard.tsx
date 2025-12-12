import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { CampaignsList } from '@/components/CampaignsList';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Campaign } from '@/lib/api';
import { useState, useMemo } from 'react';

interface Props {
  campaigns: Campaign[] | undefined;
  onViewCampaignDetails: (id: string) => void;
  onStartCampaign: (id: string) => void;
  onPauseCampaign: (id: string) => void;
  onDeleteCampaign: (id: string, name: string) => void;
  startCampaignLoading?: boolean;
  startCampaignLoadingId?: string | null;
  pauseCampaignLoading?: boolean;
  deleteCampaignLoading?: boolean;
}

export function CampaignDashboard({
  campaigns,
  onViewCampaignDetails,
  onStartCampaign,
  onPauseCampaign,
  onDeleteCampaign,
  startCampaignLoading,
  startCampaignLoadingId,
  pauseCampaignLoading,
  deleteCampaignLoading,
}: Props) {
  const navigate = useNavigate();

  // Filtering and sorting
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('recent');

  // Filter and sort campaigns
  const filteredAndSortedCampaigns = useMemo(() => {
    if (!campaigns) return [];

    let filtered = campaigns;

    // Apply status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter((c) => c.status === statusFilter);
    }

    // Apply sorting
    const sorted = [...filtered];
    switch (sortBy) {
      case 'recent':
        sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      case 'oldest':
        sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        break;
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      default:
        break;
    }

    return sorted;
  }, [campaigns, statusFilter, sortBy]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          {/* Filters / Sort on left, Create on right */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[150px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="preview">Preview</SelectItem>
                </SelectContent>
              </Select>

              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-full sm:w-[150px]">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">Most Recent</SelectItem>
                  <SelectItem value="oldest">Oldest First</SelectItem>
                  <SelectItem value="name">Name (A-Z)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button size="sm" className="gap-2" onClick={() => navigate('/campaigns/create')}>
              <Plus className="h-4 w-4" />
              Create Campaign
            </Button>
          </div>

          {/* Campaigns List */}
          <CampaignsList
            campaigns={filteredAndSortedCampaigns}
            onViewCampaignDetails={onViewCampaignDetails}
            onStartCampaign={onStartCampaign}
            onPauseCampaign={onPauseCampaign}
            onDeleteCampaign={onDeleteCampaign}
            startCampaignLoading={!!startCampaignLoading}
            startCampaignLoadingId={startCampaignLoadingId || null}
            pauseCampaignLoading={!!pauseCampaignLoading}
            deleteCampaignLoading={!!deleteCampaignLoading}
          />
        </CardContent>
      </Card>
    </div>
  );
}
