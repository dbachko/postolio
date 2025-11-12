import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, TrendingUp, TrendingDown } from 'lucide-react';
import { formatNumber } from '@/utils/formatNumber';
import { TimeSeriesChart } from './TimeSeriesChart';

interface AudienceData {
  demographics?: {
    age?: any;
    gender?: any;
    locations?: any;
  };
  followerGrowth: {
    current: number;
    change: number;
    changeRate: string;
    timeline: Array<{ date: string; followers: number }>;
  };
}

interface AudienceInsightsProps {
  audienceData?: AudienceData;
  loading?: boolean;
}

export function AudienceInsights({ audienceData, loading }: AudienceInsightsProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            <span>Audience Insights</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </CardContent>
      </Card>
    );
  }

  if (!audienceData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            <span>Audience Insights</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground py-8 text-center">
            <Users className="mx-auto mb-3 h-12 w-12 opacity-30" />
            <p className="text-sm">No audience data available</p>
            <p className="text-xs">Connect your Instagram Business account to see insights</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { followerGrowth } = audienceData;
  const isPositiveGrowth = followerGrowth.change > 0;
  const GrowthIcon = isPositiveGrowth ? TrendingUp : TrendingDown;
  const growthColor = isPositiveGrowth
    ? 'text-green-600 dark:text-green-400'
    : 'text-red-600 dark:text-red-400';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          <span>Audience Insights</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Follower Stats */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border p-4">
            <div className="text-muted-foreground mb-1 text-sm">Total Followers</div>
            <div className="text-2xl font-bold">{formatNumber(followerGrowth.current)}</div>
          </div>

          <div className="rounded-lg border p-4">
            <div className="text-muted-foreground mb-1 text-sm">Follower Change (30d)</div>
            <div className={`flex items-center gap-2 text-2xl font-bold ${growthColor}`}>
              <GrowthIcon className="h-5 w-5" />
              <span>
                {isPositiveGrowth ? '+' : ''}
                {formatNumber(followerGrowth.change)}
              </span>
            </div>
          </div>

          <div className="rounded-lg border p-4">
            <div className="text-muted-foreground mb-1 text-sm">Growth Rate</div>
            <div className={`text-2xl font-bold ${growthColor}`}>
              {isPositiveGrowth ? '+' : ''}
              {followerGrowth.changeRate}%
            </div>
          </div>
        </div>

        {/* Follower Growth Timeline */}
        {followerGrowth.timeline && followerGrowth.timeline.length > 0 && (
          <TimeSeriesChart
            title="Follower Growth (Last 30 Days)"
            series={followerGrowth.timeline.map((point) => ({
              date: point.date,
              value: point.followers,
            }))}
            label="Total followers over time"
          />
        )}

        {/* Demographics placeholder */}
        {audienceData.demographics && (
          <div className="rounded-lg border p-4">
            <div className="mb-3 text-sm font-medium">Demographics</div>
            <div className="text-muted-foreground text-xs">
              <p>Demographic data requires Instagram Insights API access.</p>
              <p className="mt-1">This feature will be available after API integration.</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
