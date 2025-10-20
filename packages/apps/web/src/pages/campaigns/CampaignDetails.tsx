import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CampaignAnalytics } from '@/components/CampaignAnalytics';
import { CampaignEditDialog } from '@/components/CampaignEditDialog';
import type { Campaign } from '@/lib/api';

interface Props {
  campaign?: Campaign;
  isLoading: boolean;
  onPause?: () => void;
}

export function CampaignDetails({ campaign, isLoading }: Props) {
  if (isLoading) {
    return <div />;
  }
  if (!campaign) return null;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{campaign.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <CampaignAnalytics campaignId={campaign.id} campaignName={campaign.name} />
        </CardContent>
      </Card>
      <CampaignEditDialog campaign={campaign} open={false} onOpenChange={() => {}} />
    </div>
  );
}
