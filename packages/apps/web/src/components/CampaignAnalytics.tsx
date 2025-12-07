import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analytics } from '../lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart, AlertCircle, Loader2 } from 'lucide-react';
import { OverviewTab } from './campaign-analytics/OverviewTab';
import { PerformanceTab } from './campaign-analytics/PerformanceTab';
import { RecommendationsTab } from './campaign-analytics/RecommendationsTab';
import { ROITab } from './campaign-analytics/ROITab';

interface CampaignAnalyticsProps {
  campaignId: string;
  campaignName: string;
  timezone?: string;
}

export function CampaignAnalytics({ campaignId, campaignName, timezone }: CampaignAnalyticsProps) {
  const [selectedTab, setSelectedTab] = useState('overview');

  // Fetch campaign metrics (v2 path, legacy-compatible shape)
  const metricsQuery = useQuery({
    queryKey: ['campaign-metrics', campaignId],
    queryFn: () => analytics.getCampaignMetrics(campaignId),
    enabled: !!campaignId,
  });

  // Fetch optimization recommendations
  const recommendationsQuery = useQuery({
    queryKey: ['campaign-recommendations', campaignId],
    queryFn: () => analytics.getCampaignRecommendations(campaignId),
    enabled: !!campaignId,
  });

  // Fetch ROI data
  const roiQuery = useQuery({
    queryKey: ['campaign-roi', campaignId],
    queryFn: () => analytics.getCampaignROI(campaignId),
    enabled: !!campaignId,
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

  const recommendations = recommendationsQuery.data?.data || [];
  const roi = roiQuery.data?.data;

  if (!metrics) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-muted-foreground text-center">No analytics data available yet</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart className="h-5 w-5" />
            {campaignName} Analytics
          </CardTitle>
          <CardDescription>Performance metrics and insights for your campaign</CardDescription>
        </CardHeader>
      </Card>

      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="recommendations">Insights</TabsTrigger>
          <TabsTrigger value="roi">ROI</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <OverviewTab metrics={metrics} />
        </TabsContent>

        <TabsContent value="performance" className="space-y-6">
          <PerformanceTab
            topHashtags={metrics.topHashtags || []}
            performanceByDate={metrics.performanceByDate || []}
            timezone={timezone}
          />
        </TabsContent>

        <TabsContent value="recommendations" className="space-y-6">
          <RecommendationsTab
            recommendations={recommendations}
            isLoading={recommendationsQuery.isLoading}
          />
        </TabsContent>

        <TabsContent value="roi" className="space-y-6">
          <ROITab roi={roi} isLoading={roiQuery.isLoading} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
