import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Eye, Heart, Users, TrendingUp, TrendingDown } from 'lucide-react';
import { formatNumber, formatPercent } from '@/utils/formatNumber';

interface CampaignMetrics {
  totalPosts: number;
  totalImpressions: number;
  totalEngagement: number;
  reach: number;
  averageEngagementRate: number;
  postsScheduled: number;
  postsPosted: number;
  postsApproved?: number;
  campaignDuration: number;
  postingFrequency: number;
}

interface OverviewTabProps {
  metrics: CampaignMetrics;
}

export function OverviewTab({ metrics }: OverviewTabProps) {
  const getPerformanceColor = (rate: number) => {
    if (rate >= 3) return 'text-green-600 dark:text-green-400';
    if (rate >= 1.5) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  const getPerformanceIcon = (rate: number) => {
    return rate >= 2 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />;
  };

  const getPerformanceLabel = (rate: number) => {
    if (rate >= 3) return 'Excellent';
    if (rate >= 1.5) return 'Good';
    return 'Needs Improvement';
  };

  return (
    <div className="space-y-6">
      {/* Key Metrics Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="bg-muted rounded-lg p-2">
              <BarChart className="h-5 w-5" />
            </div>
            <div>
              <p className="text-muted-foreground text-sm">Total Posts</p>
              <p className="text-2xl font-bold">{metrics.totalPosts}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="bg-muted rounded-lg p-2">
              <Eye className="h-5 w-5" />
            </div>
            <div>
              <p className="text-muted-foreground text-sm">Views</p>
              <p className="text-2xl font-bold">{formatNumber(metrics.totalImpressions)}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="bg-muted rounded-lg p-2">
              <Heart className="h-5 w-5" />
            </div>
            <div>
              <p className="text-muted-foreground text-sm">Engagement</p>
              <p className="text-2xl font-bold">{formatNumber(metrics.totalEngagement)}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="bg-muted rounded-lg p-2">
              <Users className="h-5 w-5" />
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
            {metrics.postsApproved !== undefined && (
              <div className="flex justify-between">
                <span className="text-muted-foreground text-sm">Posts Approved:</span>
                <span className="font-medium">{metrics.postsApproved}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground text-sm">Campaign Duration:</span>
              <span className="font-medium">{metrics.campaignDuration} days</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground text-sm">Posting Frequency:</span>
              <span className="font-medium">{Number(metrics.postingFrequency).toFixed(1)}/day</span>
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
                {formatPercent(Number(metrics.averageEngagementRate), 2)}
              </div>
              <p className="text-muted-foreground mt-2 text-sm">
                {getPerformanceLabel(metrics.averageEngagementRate)}
              </p>
              <div className="text-muted-foreground mt-4 text-xs">Industry average: 1.5-3%</div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
