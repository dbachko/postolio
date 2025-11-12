import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PageHeader } from '@/components/PageHeader';
import { ArrowLeft, TrendingUp, TrendingDown } from 'lucide-react';
import { formatPercent } from '@/utils/formatNumber';

const formatNumber = (num: number) => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toFixed(0);
};

export function CampaignComparison() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [campaignIds, setCampaignIds] = useState<string[]>([]);

  useEffect(() => {
    const ids = searchParams.get('ids');
    if (ids) {
      const parsed = ids
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
      setCampaignIds(parsed);
    }
  }, [searchParams]);

  const comparisonQuery = useQuery({
    queryKey: ['campaign-comparison', campaignIds.join(',')],
    queryFn: async () => {
      const response = await fetch(`/api/campaigns/compare?ids=${campaignIds.join(',')}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });
      if (!response.ok) throw new Error('Failed to fetch comparison data');
      return response.json();
    },
    enabled: campaignIds.length >= 1 && campaignIds.length <= 3,
  });

  if (campaignIds.length === 0) {
    return (
      <div className="container mx-auto max-w-6xl p-4">
        <PageHeader
          title="Campaign Comparison"
          description="Compare up to 3 campaigns side-by-side"
        />
        <Alert>
          <AlertDescription>
            No campaigns selected for comparison. Please select campaigns from the campaigns list.
          </AlertDescription>
        </Alert>
        <Button className="mt-4" onClick={() => navigate('/campaigns')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Campaigns
        </Button>
      </div>
    );
  }

  if (campaignIds.length > 3) {
    return (
      <div className="container mx-auto max-w-6xl p-4">
        <PageHeader
          title="Campaign Comparison"
          description="Compare up to 3 campaigns side-by-side"
        />
        <Alert variant="destructive">
          <AlertDescription>
            Too many campaigns selected. Please select up to 3 campaigns only.
          </AlertDescription>
        </Alert>
        <Button className="mt-4" onClick={() => navigate('/campaigns')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Campaigns
        </Button>
      </div>
    );
  }

  if (comparisonQuery.isLoading) {
    return (
      <div className="container mx-auto max-w-6xl p-4">
        <PageHeader title="Campaign Comparison" description="Loading comparison data..." />
        <div className="space-y-4">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  if (comparisonQuery.error) {
    return (
      <div className="container mx-auto max-w-6xl p-4">
        <PageHeader title="Campaign Comparison" description="Error loading data" />
        <Alert variant="destructive">
          <AlertDescription>
            Failed to load campaign comparison data. Please try again.
          </AlertDescription>
        </Alert>
        <Button className="mt-4" onClick={() => navigate('/campaigns')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Campaigns
        </Button>
      </div>
    );
  }

  const data = comparisonQuery.data?.data;
  if (!data) return null;

  const { campaigns, summary } = data;

  const getPerformanceColor = (value: number) => {
    if (value > 10) return 'text-green-600';
    if (value > 0) return 'text-green-500';
    if (value < -10) return 'text-red-600';
    if (value < 0) return 'text-red-500';
    return 'text-gray-600';
  };

  const getPerformanceIcon = (value: number) => {
    if (value > 0) return <TrendingUp className="h-4 w-4" />;
    if (value < 0) return <TrendingDown className="h-4 w-4" />;
    return null;
  };

  const metrics = [
    { key: 'totalImpressions', label: 'Impressions', format: formatNumber },
    { key: 'totalEngagement', label: 'Engagement', format: formatNumber },
    {
      key: 'averageEngagementRate',
      label: 'Eng. Rate',
      format: (v: number) => formatPercent(v, 1),
    },
    { key: 'postsPosted', label: 'Posts Published', format: (v: number) => v.toString() },
    { key: 'reach', label: 'Reach', format: formatNumber },
  ];

  return (
    <div className="container mx-auto max-w-6xl p-4">
      <div className="mb-6 flex items-center justify-between">
        <PageHeader
          title="Campaign Comparison"
          description={`Comparing ${campaigns.length} campaign${campaigns.length > 1 ? 's' : ''}`}
        />
        <Button variant="outline" onClick={() => navigate('/campaigns')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Campaigns
        </Button>
      </div>

      {/* Summary Card */}
      <Card className="mb-6 p-6">
        <h3 className="mb-4 text-lg font-semibold">Average Performance</h3>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="text-muted-foreground mb-1 text-xs">Avg Impressions</div>
            <div className="text-xl font-bold">{formatNumber(summary.avgImpressions)}</div>
          </div>
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="text-muted-foreground mb-1 text-xs">Avg Engagement</div>
            <div className="text-xl font-bold">{formatNumber(summary.avgEngagement)}</div>
          </div>
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="text-muted-foreground mb-1 text-xs">Avg Eng. Rate</div>
            <div className="text-xl font-bold">{formatPercent(summary.avgEngagementRate, 1)}</div>
          </div>
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="text-muted-foreground mb-1 text-xs">Avg Posts</div>
            <div className="text-xl font-bold">{Math.round(summary.avgPostsCount)}</div>
          </div>
        </div>
      </Card>

      {/* Comparison Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-medium">Metric</th>
                {campaigns.map((campaign: any) => (
                  <th key={campaign.id} className="px-6 py-4 text-left text-sm font-medium">
                    <div className="line-clamp-2">{campaign.name}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {metrics.map((metric) => (
                <tr key={metric.key} className="hover:bg-muted/50">
                  <td className="text-muted-foreground px-6 py-4 text-sm font-medium">
                    {metric.label}
                  </td>
                  {campaigns.map((campaign: any) => {
                    const value = campaign.metrics[metric.key];
                    const relativeKey =
                      metric.key === 'postsPosted'
                        ? 'postsCount'
                        : metric.key === 'averageEngagementRate'
                          ? 'engagementRate'
                          : metric.key === 'totalImpressions'
                            ? 'impressions'
                            : metric.key === 'totalEngagement'
                              ? 'engagement'
                              : metric.key;
                    const relative = campaign.relativePerformance[relativeKey];

                    return (
                      <td key={campaign.id} className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-semibold">{metric.format(value)}</span>
                          {relative !== undefined && relative !== 0 && (
                            <div
                              className={`flex items-center gap-1 text-xs ${getPerformanceColor(relative)}`}
                            >
                              {getPerformanceIcon(relative)}
                              <span>
                                {relative > 0 ? '+' : ''}
                                {formatPercent(relative, 0)}
                              </span>
                            </div>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Insights */}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {campaigns.map((campaign: any) => (
          <Card key={campaign.id} className="p-6">
            <h3 className="mb-3 text-lg font-semibold">{campaign.name}</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Posts:</span>
                <span className="font-medium">{campaign.metrics.totalPosts}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Duration:</span>
                <span className="font-medium">{campaign.metrics.campaignDuration} days</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Posting Frequency:</span>
                <span className="font-medium">
                  {campaign.metrics.postingFrequency.toFixed(2)} posts/day
                </span>
              </div>
              {campaign.metrics.performanceVsGoal && (
                <div className="bg-muted/50 mt-4 rounded-lg p-3">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Goal Progress</span>
                    <span
                      className={
                        campaign.metrics.performanceVsGoal.onTrack
                          ? 'text-green-600'
                          : 'text-orange-600'
                      }
                    >
                      {formatPercent(campaign.metrics.performanceVsGoal.progress, 0)}
                    </span>
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {campaign.metrics.performanceVsGoal.goalType.charAt(0).toUpperCase() +
                      campaign.metrics.performanceVsGoal.goalType.slice(1)}{' '}
                    Goal
                  </div>
                </div>
              )}
            </div>
            <Button
              className="mt-4 w-full"
              variant="outline"
              size="sm"
              onClick={() => navigate(`/campaigns/${campaign.id}`)}
            >
              View Details
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
