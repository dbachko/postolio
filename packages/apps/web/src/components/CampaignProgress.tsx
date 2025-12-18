import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { campaign as campaignApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface CampaignProgressProps {
  brandId?: string;
  allBrands?: boolean;
}

function getStatusTextClass(status: string): string {
  if (status === 'active') return 'text-green-600 dark:text-green-400';
  if (status === 'paused') return 'text-yellow-600 dark:text-yellow-400';
  return 'text-muted-foreground';
}

export function CampaignProgress({ brandId, allBrands = false }: CampaignProgressProps) {
  const navigate = useNavigate();

  // Fetch campaigns
  const campaignsQuery = useQuery({
    queryKey: allBrands ? ['allCampaigns'] : ['campaigns', brandId],
    queryFn: () => campaignApi.listCampaigns(brandId),
    enabled: allBrands || !!brandId,
    staleTime: 5 * 60 * 1000,
  });

  const campaigns = useMemo(
    () => (campaignsQuery.data as any)?.campaigns || [],
    [campaignsQuery.data]
  );

  // For now, we'll show campaigns without detailed progress since we'd need
  // to fetch content data for each campaign individually which would be expensive.
  // The progress data will be added in a future iteration.
  const campaignProgress = useMemo(() => {
    return (campaigns as any[]).map((campaign: any) => ({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      brandId: campaign.brandId,
      description: campaign.description,
      createdAt: campaign.createdAt,
    }));
  }, [campaigns]);

  const handleViewCampaign = (campaign: any) => {
    navigate(`/campaigns/${campaign.id}`);
  };

  if (campaignsQuery.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="border-foreground h-8 w-8 animate-spin rounded-full border-b-2"></div>
        </CardContent>
      </Card>
    );
  }

  if (campaignProgress.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {campaignProgress.slice(0, 3).map((campaign) => (
        <Card key={campaign.id}>
          <CardHeader>
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <CardTitle className="text-lg break-words">{campaign.name}</CardTitle>
                <p className="text-muted-foreground mt-1 text-sm break-words whitespace-normal">
                  Status:{' '}
                  <span className={`capitalize ${getStatusTextClass(campaign.status)}`}>
                    {campaign.status}
                  </span>
                  {campaign.brandId && (
                    <span className="break-all"> • Brand: {campaign.brandId}</span>
                  )}
                </p>
                {campaign.description && (
                  <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                    {campaign.description}
                  </p>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={() => handleViewCampaign(campaign)}>
                View
              </Button>
            </div>
          </CardHeader>
        </Card>
      ))}
      {campaignProgress.length > 3 && (
        <p className="text-muted-foreground pt-2 text-center text-sm">
          And {campaignProgress.length - 3} more campaigns...
        </p>
      )}
    </div>
  );
}
