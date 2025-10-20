import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Campaigns</CardTitle>
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
