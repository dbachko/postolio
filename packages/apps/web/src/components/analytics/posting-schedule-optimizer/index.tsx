import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Clock, TrendingUp, Calendar, Star, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface PostingTimeRecommendation {
  dayOfWeek: string;
  hour: number;
  score: number;
  avgEngagement: number;
  postCount: number;
  confidence: number;
  reason: string;
}

interface PostingScheduleOptimizerProps {
  postingTimes?: PostingTimeRecommendation[];
  loading?: boolean;
}

export function PostingScheduleOptimizer({ postingTimes, loading }: PostingScheduleOptimizerProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Optimal Posting Schedule</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-6 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!postingTimes || postingTimes.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="text-primary h-5 w-5" />
            <CardTitle>Optimal Posting Schedule</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground py-12 text-center">
            <div className="mb-4">
              <Calendar className="mx-auto h-12 w-12 opacity-50" />
            </div>
            <p className="text-sm">Not enough data for schedule optimization</p>
            <p className="text-xs">Post at different times to discover your optimal schedule</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const formatTime = (hour: number) => {
    const ampm = hour >= 12 ? 'PM' : 'AM';
    let displayHour = hour;
    if (hour === 0) {
      displayHour = 12;
    } else if (hour > 12) {
      displayHour = hour - 12;
    }
    return `${displayHour}:00 ${ampm}`;
  };

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 75) {
      return 'High';
    }
    if (confidence >= 50) {
      return 'Medium';
    }
    return 'Low';
  };

  // Group by day for visual organization
  const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const groupedByDay = new Map<string, PostingTimeRecommendation[]>();

  for (const time of postingTimes) {
    if (!groupedByDay.has(time.dayOfWeek)) {
      groupedByDay.set(time.dayOfWeek, []);
    }
    groupedByDay.get(time.dayOfWeek)!.push(time);
  }

  // Sort each day's times by score
  for (const times of groupedByDay.values()) {
    times.sort((a, b) => b.score - a.score);
  }

  const topRecommendations = postingTimes.slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="text-primary h-5 w-5" />
            <CardTitle>Optimal Posting Schedule</CardTitle>
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="text-muted-foreground h-4 w-4" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="text-xs">
                  Based on your historical performance, these times show when your audience engages
                  most.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Top 5 Best Times */}
          <div>
            <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Star className="h-4 w-4 text-yellow-500" />
              Top 5 Best Times to Post
            </h4>
            <div className="space-y-2">
              {topRecommendations.map((time, index) => {
                let rankClassName = 'bg-muted/50 text-muted-foreground';
                if (index === 0) {
                  rankClassName =
                    'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-400';
                } else if (index === 1) {
                  rankClassName =
                    'bg-gray-100 text-gray-700 dark:bg-gray-950/30 dark:text-gray-400';
                } else if (index === 2) {
                  rankClassName =
                    'bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400';
                }

                let confidenceClassName =
                  'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-400';
                if (time.confidence >= 75) {
                  confidenceClassName =
                    'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-400';
                } else if (time.confidence >= 50) {
                  confidenceClassName =
                    'border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-900 dark:bg-yellow-950/30 dark:text-yellow-400';
                }

                return (
                  <div
                    key={`${time.dayOfWeek}-${time.hour}`}
                    className="border-border/50 bg-card/50 hover:border-border flex items-center gap-3 rounded-lg border p-3 transition-all"
                  >
                    {/* Rank badge */}
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${rankClassName}`}
                    >
                      #{index + 1}
                    </div>

                    {/* Time details */}
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-sm font-semibold">{time.dayOfWeek}</span>
                        <span className="text-muted-foreground text-sm">
                          at {formatTime(time.hour)}
                        </span>
                      </div>
                      <div className="text-muted-foreground flex items-center gap-3 text-xs">
                        <div className="flex items-center gap-1">
                          <TrendingUp className="h-3 w-3" />
                          <span>{Math.round(time.avgEngagement)} avg engagement</span>
                        </div>
                        <div>•</div>
                        <div>{time.postCount} posts</div>
                      </div>
                    </div>

                    {/* Confidence indicator */}
                    <div className="flex flex-col items-end gap-1">
                      <Badge
                        variant="outline"
                        className={`text-xs font-medium ${confidenceClassName}`}
                      >
                        {getConfidenceLabel(time.confidence)}
                      </Badge>
                      <div className="text-muted-foreground flex items-center gap-1 text-xs">
                        <span>{time.confidence}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Schedule by Day */}
          {groupedByDay.size > 0 && (
            <div className="border-t pt-4">
              <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Calendar className="text-primary h-4 w-4" />
                Weekly Schedule Overview
              </h4>
              <div className="space-y-2">
                {dayOrder.map((day) => {
                  const dayTimes = groupedByDay.get(day);
                  if (!dayTimes || dayTimes.length === 0) {
                    return null;
                  }

                  const bestTime = dayTimes[0];

                  return (
                    <div
                      key={day}
                      className="bg-muted/30 flex items-center justify-between rounded-lg p-3 text-sm"
                    >
                      <div className="font-medium">{day}</div>
                      <div className="flex items-center gap-3">
                        <div className="text-muted-foreground">
                          Best:{' '}
                          <span className="text-foreground font-medium">
                            {formatTime(bestTime.hour)}
                          </span>
                        </div>
                        {dayTimes.length > 1 && (
                          <Badge variant="secondary" className="text-xs">
                            +{dayTimes.length - 1} more
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quick tip */}
          <div className="bg-muted/50 flex items-start gap-2 rounded-md p-3 text-xs">
            <Info className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
            <div className="text-muted-foreground">
              <span className="font-medium">Pro Tip:</span> Consistency matters! Try posting at
              these optimal times for 2-3 weeks to maximize engagement. Results improve with more
              data.
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
