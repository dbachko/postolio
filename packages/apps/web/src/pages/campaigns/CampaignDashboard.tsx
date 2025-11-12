import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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

  // Week 3: Filtering, sorting, and comparison
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('recent');
  const [selectedCampaigns, setSelectedCampaigns] = useState<Set<string>>(new Set());
  const [comparisonMode, setComparisonMode] = useState(false);

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

  const handleToggleCampaign = (campaignId: string) => {
    const newSelected = new Set(selectedCampaigns);
    if (newSelected.has(campaignId)) {
      newSelected.delete(campaignId);
    } else {
      if (newSelected.size >= 3) {
        // Max 3 campaigns for comparison
        return;
      }
      newSelected.add(campaignId);
    }
    setSelectedCampaigns(newSelected);
  };

  const handleCompare = () => {
    const ids = Array.from(selectedCampaigns).join(',');
    navigate(`/campaigns/compare?ids=${ids}`);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>Campaigns</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={comparisonMode ? 'default' : 'outline'}
                onClick={() => {
                  setComparisonMode(!comparisonMode);
                  setSelectedCampaigns(new Set());
                }}
              >
                {comparisonMode ? 'Cancel Compare' : 'Compare Campaigns'}
              </Button>
              <Button size="sm" className="gap-2" onClick={() => navigate('/campaigns/create')}>
                <Plus className="h-4 w-4" />
                Create Campaign
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters and Sort */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]">
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
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Most Recent</SelectItem>
                <SelectItem value="oldest">Oldest First</SelectItem>
                <SelectItem value="name">Name (A-Z)</SelectItem>
              </SelectContent>
            </Select>

            {comparisonMode && selectedCampaigns.size > 0 && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{selectedCampaigns.size} selected</Badge>
                <Button size="sm" onClick={handleCompare} disabled={selectedCampaigns.size < 1}>
                  Compare Selected
                </Button>
              </div>
            )}

            <div className="text-muted-foreground ml-auto text-sm">
              {filteredAndSortedCampaigns.length} campaign
              {filteredAndSortedCampaigns.length !== 1 ? 's' : ''}
            </div>
          </div>

          {/* Campaigns List */}
          {comparisonMode ? (
            <div className="grid grid-cols-1 gap-4">
              {filteredAndSortedCampaigns.map((campaign: Campaign) => (
                <div key={campaign.id} className="flex items-start gap-3">
                  <Checkbox
                    checked={selectedCampaigns.has(campaign.id)}
                    onCheckedChange={() => handleToggleCampaign(campaign.id)}
                    disabled={!selectedCampaigns.has(campaign.id) && selectedCampaigns.size >= 3}
                    className="mt-6"
                  />
                  <div className="flex-1">
                    {/* Render existing CampaignCard but make it non-clickable */}
                    <div onClick={(e) => e.preventDefault()}>
                      <CampaignsList
                        campaigns={[campaign]}
                        onViewCampaignDetails={() => {}}
                        onStartCampaign={onStartCampaign}
                        onPauseCampaign={onPauseCampaign}
                        onDeleteCampaign={onDeleteCampaign}
                        startCampaignLoading={!!startCampaignLoading}
                        startCampaignLoadingId={startCampaignLoadingId || null}
                        pauseCampaignLoading={!!pauseCampaignLoading}
                        deleteCampaignLoading={!!deleteCampaignLoading}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
