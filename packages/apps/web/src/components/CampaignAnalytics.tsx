import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { campaign as campaignApi } from '../lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import {
  BarChart,
  TrendingUp,
  TrendingDown,
  Users,
  Eye,
  Heart,
  Hash,
  DollarSign,
  Lightbulb,
  AlertCircle,
  Loader2,
} from 'lucide-react';

interface CampaignAnalyticsProps {
  campaignId: string;
  campaignName: string;
}

export function CampaignAnalytics({ campaignId, campaignName }: CampaignAnalyticsProps) {
  const [selectedTab, setSelectedTab] = useState('overview');

  // Fetch campaign metrics
  const metricsQuery = useQuery({
    queryKey: ['campaign-metrics', campaignId],
    queryFn: () => campaignApi.getCampaignMetrics(campaignId),
    enabled: !!campaignId,
  });

  // Fetch optimization recommendations
  const recommendationsQuery = useQuery({
    queryKey: ['campaign-recommendations', campaignId],
    queryFn: () => campaignApi.getCampaignRecommendations(campaignId),
    enabled: !!campaignId,
  });

  // Fetch ROI data
  const roiQuery = useQuery({
    queryKey: ['campaign-roi', campaignId],
    queryFn: () => campaignApi.getCampaignROI(campaignId),
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
          <div className="flex items-center justify-center text-red-600">
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
          <div className="text-center text-gray-600">No analytics data available yet</div>
        </CardContent>
      </Card>
    );
  }

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const getPerformanceColor = (rate: number) => {
    if (rate >= 3) return 'text-green-600';
    if (rate >= 1.5) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getPerformanceIcon = (rate: number) => {
    return rate >= 2 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />;
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low':
        return 'bg-green-100 text-green-800 border-green-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

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
          {/* Key Metrics Cards */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="rounded-lg bg-blue-100 p-2">
                  <BarChart className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-muted-foreground text-sm">Total Posts</p>
                  <p className="text-2xl font-bold">{metrics.totalPosts}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="rounded-lg bg-purple-100 p-2">
                  <Eye className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-muted-foreground text-sm">Impressions</p>
                  <p className="text-2xl font-bold">{formatNumber(metrics.totalImpressions)}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="rounded-lg bg-green-100 p-2">
                  <Heart className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-muted-foreground text-sm">Engagement</p>
                  <p className="text-2xl font-bold">{formatNumber(metrics.totalEngagement)}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="rounded-lg bg-orange-100 p-2">
                  <Users className="h-5 w-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-muted-foreground text-sm">Reach</p>
                  <p className="text-2xl font-bold">{formatNumber(metrics.reach)}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Campaign Stats */}
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Campaign Progress</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between">
                  <span className="text-muted-foreground text-sm">Posts Scheduled:</span>
                  <span className="font-medium">{metrics.postsScheduled}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground text-sm">Posts Posted:</span>
                  <span className="font-medium">{metrics.postsPosted}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground text-sm">Posts Approved:</span>
                  <span className="font-medium">{metrics.postsApproved}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground text-sm">Campaign Duration:</span>
                  <span className="font-medium">{metrics.campaignDuration} days</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground text-sm">Posting Frequency:</span>
                  <span className="font-medium">{metrics.postingFrequency.toFixed(1)}/day</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <div
                    className={`flex items-center gap-1 ${getPerformanceColor(metrics.averageEngagementRate)}`}
                  >
                    {getPerformanceIcon(metrics.averageEngagementRate)}
                    Engagement Rate
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center">
                  <div
                    className={`text-4xl font-bold ${getPerformanceColor(metrics.averageEngagementRate)}`}
                  >
                    {metrics.averageEngagementRate.toFixed(2)}%
                  </div>
                  <p className="text-muted-foreground mt-2 text-sm">
                    {metrics.averageEngagementRate >= 3
                      ? 'Excellent'
                      : metrics.averageEngagementRate >= 1.5
                        ? 'Good'
                        : 'Needs Improvement'}
                  </p>
                  <div className="text-muted-foreground mt-4 text-xs">Industry average: 1.5-3%</div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="performance" className="space-y-6">
          {/* Top Hashtags */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Hash className="h-5 w-5" />
                Top Performing Hashtags
              </CardTitle>
              <CardDescription>Best hashtags by average engagement</CardDescription>
            </CardHeader>
            <CardContent>
              {metrics.topHashtags.length === 0 ? (
                <p className="text-muted-foreground py-4 text-center">
                  No hashtag data available yet
                </p>
              ) : (
                <div className="space-y-3">
                  {metrics.topHashtags.slice(0, 10).map((hashtag: any, index: number) => (
                    <div key={hashtag.tag} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Badge variant="outline">#{index + 1}</Badge>
                        <span className="font-medium">#{hashtag.tag}</span>
                      </div>
                      <div className="text-right">
                        <div className="font-medium">{formatNumber(hashtag.avgEngagement)}</div>
                        <div className="text-muted-foreground text-xs">
                          Used {hashtag.count} time
                          {hashtag.count !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Performance Timeline */}
          <Card>
            <CardHeader>
              <CardTitle>Performance Timeline</CardTitle>
              <CardDescription>Daily performance breakdown</CardDescription>
            </CardHeader>
            <CardContent>
              {metrics.performanceByDate.length === 0 ? (
                <p className="text-muted-foreground py-4 text-center">
                  No performance timeline data available yet
                </p>
              ) : (
                <div className="space-y-3">
                  {metrics.performanceByDate.slice(-7).map((day: any) => (
                    <div key={day.date} className="flex items-center justify-between">
                      <span className="text-sm">{format(new Date(day.date), 'MMM d, yyyy')}</span>
                      <div className="flex gap-4 text-sm">
                        <span>{formatNumber(day.impressions)} impressions</span>
                        <span>{formatNumber(day.engagement)} engagement</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recommendations" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="h-5 w-5" />
                Optimization Recommendations
              </CardTitle>
              <CardDescription>
                AI-powered insights to improve your campaign performance
              </CardDescription>
            </CardHeader>
            <CardContent>
              {recommendationsQuery.isLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Loading recommendations...
                </div>
              ) : recommendations.length === 0 ? (
                <div className="py-8 text-center">
                  <Lightbulb className="mx-auto mb-4 h-12 w-12 text-gray-400" />
                  <h3 className="mb-2 font-medium text-gray-900">No recommendations yet</h3>
                  <p className="text-gray-600">
                    We'll provide optimization insights once your campaign has more data.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {recommendations.map((rec: any, index: number) => (
                    <Card key={index} className="border-l-4 border-l-blue-500">
                      <CardContent className="p-4">
                        <div className="mb-2 flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <Badge className={getPriorityColor(rec.priority)}>
                              {rec.priority} priority
                            </Badge>
                            <Badge variant="outline">{rec.type}</Badge>
                          </div>
                        </div>
                        <p className="mb-2 text-sm font-medium">{rec.message}</p>
                        <p className="text-muted-foreground mb-3 text-xs">
                          Expected impact: {rec.impact}
                        </p>
                        {rec.actionable && (
                          <Button size="sm" variant="outline">
                            Take Action
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roi" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Return on Investment
              </CardTitle>
              <CardDescription>Estimated value generated by your campaign</CardDescription>
            </CardHeader>
            <CardContent>
              {roiQuery.isLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Calculating ROI...
                </div>
              ) : !roi ? (
                <p className="text-muted-foreground py-4 text-center">ROI data not available</p>
              ) : (
                <div className="space-y-6">
                  <div className="text-center">
                    <div className="text-4xl font-bold text-green-600">
                      ${roi.estimatedValue.toFixed(2)}
                    </div>
                    <p className="text-muted-foreground text-sm">Estimated campaign value</p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <Card>
                      <CardContent className="p-4">
                        <div className="text-center">
                          <p className="text-muted-foreground text-sm">Engagement Value</p>
                          <p className="text-2xl font-bold">${roi.engagementValue.toFixed(2)}</p>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="p-4">
                        <div className="text-center">
                          <p className="text-muted-foreground text-sm">Reach Value</p>
                          <p className="text-2xl font-bold">${roi.reachValue.toFixed(2)}</p>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="space-y-2 text-sm">
                    <h4 className="font-medium">Calculation Breakdown:</h4>
                    <div className="flex justify-between">
                      <span>Cost per engagement:</span>
                      <span>${roi.breakdown.costPerEngagement}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Value per impression:</span>
                      <span>${roi.breakdown.valuePerImpression}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Estimated reach:</span>
                      <span>{formatNumber(roi.breakdown.estimatedReach)}</span>
                    </div>
                  </div>

                  <div className="text-muted-foreground rounded bg-gray-50 p-3 text-xs">
                    <strong>Methodology:</strong> {roi.methodology}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
