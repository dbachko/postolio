import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { CampaignsList } from '@/components/CampaignsList';
import type { Campaign } from '@/lib/api';

interface Props {
  campaigns: Campaign[] | undefined;
  onViewCampaignDetails: (id: string) => void;
  onStartCampaign: (id: string) => void;
  onPauseCampaign: (id: string) => void;
  onDeleteCampaign: (id: string, name: string) => void;
  startCampaignLoading?: boolean;
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
  pauseCampaignLoading,
  deleteCampaignLoading,
}: Props) {
  const navigate = useNavigate();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Campaigns</CardTitle>
            <Button size="sm" className="gap-2" onClick={() => navigate('/campaigns/create')}>
              <Plus className="h-4 w-4" />
              Create Campaign
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <CampaignsList
            campaigns={campaigns || []}
            onViewCampaignDetails={onViewCampaignDetails}
            onStartCampaign={onStartCampaign}
            onPauseCampaign={onPauseCampaign}
            onDeleteCampaign={onDeleteCampaign}
            startCampaignLoading={!!startCampaignLoading}
            pauseCampaignLoading={!!pauseCampaignLoading}
            deleteCampaignLoading={!!deleteCampaignLoading}
          />
        </CardContent>
      </Card>
    </div>
  );
}
