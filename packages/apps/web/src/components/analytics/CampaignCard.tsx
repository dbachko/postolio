import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, TrendingDown, Minus, Calendar, FileText, Heart } from 'lucide-react';
import { formatNumber, formatPercent } from '@/utils/formatNumber';
import { formatDate } from '@/utils/formatDate';

interface CampaignCardProps {
  campaign: {
    id: string;
    name: string;
    status: 'active' | 'completed' | 'paused';
    startDate?: string;
    endDate?: string;
    metrics: {
      totalPosts: number;
      totalEngagement: number;
      averageEngagementRate: number;
    };
    performanceVsGoal?: {
      goalType: string;
      progress: number;
      onTrack: boolean;
    };
    trend?: 'up' | 'down' | 'neutral';
  };
  onClick: (campaignId: string) => void;
  loading?: boolean;
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'active':
      return 'bg-green-500';
    case 'completed':
      return 'bg-blue-500';
    case 'paused':
      return 'bg-yellow-500';
    default:
      return 'bg-gray-500';
  }
};

const getStatusBadgeVariant = (
  status: string
): 'default' | 'secondary' | 'destructive' | 'outline' => {
  switch (status) {
    case 'active':
      return 'default';
    case 'completed':
      return 'secondary';
    case 'paused':
      return 'outline';
    default:
      return 'secondary';
  }
};

export function CampaignCard({ campaign, onClick, loading }: CampaignCardProps) {
  if (loading) {
    return (
      <Card className="overflow-hidden">
        <div className="border-l-4 border-gray-300 p-6">
          <Skeleton className="mb-2 h-6 w-3/4" />
          <Skeleton className="mb-4 h-4 w-1/2" />
          <div className="mb-4 grid grid-cols-3 gap-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
          <Skeleton className="h-2 w-full" />
        </div>
      </Card>
    );
  }

  const TrendIcon =
    campaign.trend === 'up' ? TrendingUp : campaign.trend === 'down' ? TrendingDown : Minus;
  const trendColor =
    campaign.trend === 'up'
      ? 'text-green-600 dark:text-green-400'
      : campaign.trend === 'down'
        ? 'text-red-600 dark:text-red-400'
        : 'text-gray-400 dark:text-gray-500';

  return (
    <Card
      className={`cursor-pointer overflow-hidden transition-all hover:shadow-lg ${getStatusColor(
        campaign.status
      )}`}
      onClick={() => onClick(campaign.id)}
    >
      <div className={`border-l-4 ${getStatusColor(campaign.status)} p-6`}>
        {/* Header */}
        <div className="mb-3 flex items-start justify-between">
          <div className="flex-1">
            <h3 className="line-clamp-1 text-lg font-semibold">{campaign.name}</h3>
            <div className="text-muted-foreground mt-1 flex items-center gap-2 text-sm">
              <Calendar className="h-3.5 w-3.5" />
              <span>
                {formatDate(campaign.startDate)} - {formatDate(campaign.endDate)}
              </span>
            </div>
          </div>
          <div className="ml-2 flex flex-col items-end gap-2">
            <Badge variant={getStatusBadgeVariant(campaign.status)}>
              {campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)}
            </Badge>
            {campaign.trend && <TrendIcon className={`h-5 w-5 ${trendColor}`} />}
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="mb-4 grid grid-cols-3 gap-3">
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-muted-foreground mb-1 flex items-center gap-2 text-xs">
              <FileText className="h-3.5 w-3.5" />
              <span>Posts</span>
            </div>
            <div className="text-lg font-bold">{campaign.metrics.totalPosts}</div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-muted-foreground mb-1 flex items-center gap-2 text-xs">
              <Heart className="h-3.5 w-3.5" />
              <span>Engagement</span>
            </div>
            <div className="text-lg font-bold">
              {formatNumber(campaign.metrics.totalEngagement)}
            </div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-muted-foreground mb-1 flex items-center gap-2 text-xs">
              <TrendingUp className="h-3.5 w-3.5" />
              <span>Avg Rate</span>
            </div>
            <div className="text-lg font-bold">
              {formatPercent(campaign.metrics.averageEngagementRate)}
            </div>
          </div>
        </div>

        {/* Performance vs Goal */}
        {campaign.performanceVsGoal && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {campaign.performanceVsGoal.goalType.charAt(0).toUpperCase() +
                  campaign.performanceVsGoal.goalType.slice(1)}{' '}
                Goal
              </span>
              <span
                className={
                  campaign.performanceVsGoal.onTrack
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-orange-600 dark:text-orange-400'
                }
              >
                {formatPercent(campaign.performanceVsGoal.progress, 0)}
              </span>
            </div>
            <Progress value={Math.min(campaign.performanceVsGoal.progress, 100)} className="h-2" />
            {campaign.performanceVsGoal.onTrack ? (
              <p className="text-xs text-green-600 dark:text-green-400">On track to meet goal</p>
            ) : (
              <p className="text-xs text-orange-600 dark:text-orange-400">Behind goal target</p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
