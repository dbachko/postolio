import { useQuery } from '@tanstack/react-query';
import { analytics } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle, Loader2 } from 'lucide-react';
import { OverviewTab } from './overview-tab';

interface CampaignAnalyticsProps {
  campaignId: string;
}

export function CampaignAnalytics({ campaignId }: CampaignAnalyticsProps) {
  // Fetch campaign metrics (v2 path, legacy-compatible shape)
  const metricsQuery = useQuery({
    queryKey: ['campaign-metrics', campaignId],
    queryFn: () => analytics.getCampaignMetrics(campaignId),
    enabled: !!campaignId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (metricsQuery.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="mr-2 h-6 w-6 animate-spin" />
          Loading analytics...
        </CardContent>
      </Card>
    );
  }

  if (metricsQuery.error) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-destructive flex items-center justify-center">
            <AlertCircle className="mr-2 h-5 w-5" />
            Failed to load analytics data
          </div>
        </CardContent>
      </Card>
    );
  }

  const metrics = metricsQuery.data?.data;

  if (!metrics) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-muted-foreground text-center">No analytics data available yet</div>
        </CardContent>
      </Card>
    );
  }

  return <OverviewTab metrics={metrics} />;
}
