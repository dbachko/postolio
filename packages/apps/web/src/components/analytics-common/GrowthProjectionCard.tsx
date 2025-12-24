import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Users, Heart, ArrowRight, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatNumber, formatGrowth } from '@/utils/formatNumber';

interface GrowthProjection {
  current: number;
  predicted: number;
  growth: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  confidence: number;
}

interface GrowthProjectionCardProps {
  followerGrowth?: GrowthProjection;
  engagementGrowth?: GrowthProjection;
  loading?: boolean;
  timeframe?: number;
}

export function GrowthProjectionCard({
  followerGrowth,
  engagementGrowth,
  loading,
  timeframe = 30,
}: GrowthProjectionCardProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Growth Projections</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="space-y-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-16 w-full" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!followerGrowth && !engagementGrowth) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Growth Projections</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground py-12 text-center">
            <div className="mb-4">
              <TrendingUp className="mx-auto h-12 w-12 opacity-50" />
            </div>
            <p className="text-sm">Insufficient data for growth projections</p>
            <p className="text-xs">Publish at least 10 posts to unlock predictions</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getTrendIcon = (trend: string) => {
    if (trend === 'increasing') return TrendingUp;
    if (trend === 'decreasing') return TrendingDown;
    return ArrowRight;
  };

  const getTrendColor = (trend: string) => {
    switch (trend) {
      case 'increasing':
        return 'text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30';
      case 'decreasing':
        return 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30';
      default:
        return 'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-900/30';
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 75) return 'bg-green-500 dark:bg-green-600';
    if (confidence >= 50) return 'bg-yellow-500 dark:bg-yellow-600';
    return 'bg-orange-500 dark:bg-orange-600';
  };

  const ProjectionItem = ({
    icon: Icon,
    title,
    projection,
    iconColor,
  }: {
    icon: any;
    title: string;
    projection: GrowthProjection;
    iconColor: string;
  }) => {
    const TrendIcon = getTrendIcon(projection.trend);

    return (
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconColor}`}>
              <Icon className="h-4 w-4" />
            </div>
            <h4 className="text-sm font-semibold">{title}</h4>
          </div>
          <Badge variant="outline" className="text-xs">
            {timeframe} days
          </Badge>
        </div>

        {/* Projection */}
        <div className="border-border/50 bg-card/50 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            {/* Current → Predicted */}
            <div className="flex items-center gap-3">
              <div>
                <div className="text-muted-foreground mb-1 text-xs">Current</div>
                <div className="text-xl font-bold">{formatNumber(projection.current)}</div>
              </div>

              <ArrowRight className="text-muted-foreground h-4 w-4" />

              <div>
                <div className="text-muted-foreground mb-1 text-xs">Predicted</div>
                <div className="text-xl font-bold">{formatNumber(projection.predicted)}</div>
              </div>
            </div>

            {/* Growth badge */}
            <div
              className={`flex items-center gap-1 rounded-full px-3 py-1.5 ${getTrendColor(projection.trend)}`}
            >
              <TrendIcon className="h-4 w-4" />
              <span className="text-sm font-semibold">{formatGrowth(projection.growth)}</span>
            </div>
          </div>

          {/* Confidence bar */}
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Prediction Confidence</span>
              <span className="font-medium">{projection.confidence}%</span>
            </div>
            <div className="bg-muted h-2 overflow-hidden rounded-full">
              <div
                className={`h-full rounded-full transition-all ${getConfidenceColor(projection.confidence)}`}
                style={{ width: `${projection.confidence}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>Growth Projections</CardTitle>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="text-muted-foreground h-4 w-4" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">
                    AI-powered predictions of your account growth over the next {timeframe} days
                    based on historical trends.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Follower Growth */}
          {followerGrowth && (
            <ProjectionItem
              icon={Users}
              title="Follower Growth"
              projection={followerGrowth}
              iconColor="text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30"
            />
          )}

          {/* Engagement Growth */}
          {engagementGrowth && (
            <ProjectionItem
              icon={Heart}
              title="Engagement Growth"
              projection={engagementGrowth}
              iconColor="text-pink-600 dark:text-pink-400 bg-pink-100 dark:bg-pink-900/30"
            />
          )}
        </div>

        {/* Info box */}
        <div className="bg-muted/50 mt-4 flex items-start gap-2 rounded-md p-3 text-xs">
          <Info className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
          <div className="text-muted-foreground">
            <span className="font-medium">Note:</span> Projections are based on your recent posting
            activity and engagement patterns. Actual results may vary based on content quality and
            posting consistency.
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
