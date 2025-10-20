import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CampaignAnalytics } from '@/components/CampaignAnalytics';
import { CampaignEditDialog } from '@/components/CampaignEditDialog';
import { ContentCard } from '@/components/ContentCard';
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
      <Card>
        <CardHeader>
          <CardTitle>Posts</CardTitle>
        </CardHeader>
        <CardContent>
          {Array.isArray(campaign.content) && campaign.content.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {campaign.content.map((item) => (
                <ContentCard key={item.id} content={item as any} brandId={campaign.brandId} />
              ))}
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-gray-500">
              No posts yet for this campaign
            </div>
          )}
        </CardContent>
      </Card>
      <CampaignEditDialog campaign={campaign} open={false} onOpenChange={() => {}} />
    </div>
  );
}
