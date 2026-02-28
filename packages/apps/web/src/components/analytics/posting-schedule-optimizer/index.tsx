import type { ReactNode } from 'react';
import { Calendar, Clock, Info, Star, TrendingUp } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function formatTime(hour: number): string {
  const ampm = hour >= 12 ? 'PM' : 'AM';
  if (hour === 0) {
    return `12:00 ${ampm}`;
  }
  if (hour > 12) {
    return `${hour - 12}:00 ${ampm}`;
  }
  return `${hour}:00 ${ampm}`;
}

function getConfidenceLabel(confidence: number): string {
  if (confidence >= 75) {
    return 'High';
  }
  if (confidence >= 50) {
    return 'Medium';
  }
  return 'Low';
}

function getRankClassName(index: number): string {
  if (index === 0) {
    return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-400';
  }
  if (index === 1) {
    return 'bg-gray-100 text-gray-700 dark:bg-gray-950/30 dark:text-gray-400';
  }
  if (index === 2) {
    return 'bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400';
  }
  return 'bg-muted/50 text-muted-foreground';
}

function getConfidenceClassName(confidence: number): string {
  if (confidence >= 75) {
    return 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-400';
  }
  if (confidence >= 50) {
    return 'border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-900 dark:bg-yellow-950/30 dark:text-yellow-400';
  }
  return 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-400';
}

function OptimizerCard(props: { children: ReactNode; showInfo?: boolean }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="text-primary h-5 w-5" />
            <CardTitle>Optimal Posting Schedule</CardTitle>
          </div>
          {props.showInfo ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="text-muted-foreground h-4 w-4" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">
                    Based on your historical performance, these times show when your audience
                    engages most.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
  );
}

function LoadingState() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Optimal Posting Schedule</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {[...Array(5)].map((_, index) => (
            <div key={index} className="flex items-center gap-3">
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

function EmptyState() {
  return (
    <OptimizerCard>
      <div className="text-muted-foreground py-12 text-center">
        <div className="mb-4">
          <Calendar className="mx-auto h-12 w-12 opacity-50" />
        </div>
        <p className="text-sm">Not enough data for schedule optimization</p>
        <p className="text-xs">Post at different times to discover your optimal schedule</p>
      </div>
    </OptimizerCard>
  );
}

function TopRecommendationItem(props: { time: PostingTimeRecommendation; index: number }) {
  const { time, index } = props;

  return (
    <div className="border-border/50 bg-card/50 hover:border-border flex items-center gap-3 rounded-lg border p-3 transition-all">
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${getRankClassName(index)}`}
      >
        #{index + 1}
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-sm font-semibold">{time.dayOfWeek}</span>
          <span className="text-muted-foreground text-sm">at {formatTime(time.hour)}</span>
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

      <div className="flex flex-col items-end gap-1">
        <Badge
          variant="outline"
          className={`text-xs font-medium ${getConfidenceClassName(time.confidence)}`}
        >
          {getConfidenceLabel(time.confidence)}
        </Badge>
        <div className="text-muted-foreground flex items-center gap-1 text-xs">
          <span>{time.confidence}%</span>
        </div>
      </div>
    </div>
  );
}

function TopRecommendations(props: { postingTimes: PostingTimeRecommendation[] }) {
  const topRecommendations = props.postingTimes.slice(0, 5);

  return (
    <div>
      <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Star className="h-4 w-4 text-yellow-500" />
        Top 5 Best Times to Post
      </h4>
      <div className="space-y-2">
        {topRecommendations.map((time, index) => (
          <TopRecommendationItem key={`${time.dayOfWeek}-${time.hour}`} time={time} index={index} />
        ))}
      </div>
    </div>
  );
}

function WeeklyScheduleOverview(props: { postingTimes: PostingTimeRecommendation[] }) {
  const groupedByDay = new Map<string, PostingTimeRecommendation[]>();

  for (const time of props.postingTimes) {
    if (!groupedByDay.has(time.dayOfWeek)) {
      groupedByDay.set(time.dayOfWeek, []);
    }
    groupedByDay.get(time.dayOfWeek)!.push(time);
  }

  for (const dayTimes of groupedByDay.values()) {
    dayTimes.sort((a, b) => b.score - a.score);
  }

  if (groupedByDay.size === 0) {
    return null;
  }

  return (
    <div className="border-t pt-4">
      <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Calendar className="text-primary h-4 w-4" />
        Weekly Schedule Overview
      </h4>
      <div className="space-y-2">
        {DAY_ORDER.map((day) => {
          const dayTimes = groupedByDay.get(day);
          if (!dayTimes?.length) {
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
                  <span className="text-foreground font-medium">{formatTime(bestTime.hour)}</span>
                </div>
                {dayTimes.length > 1 ? (
                  <Badge variant="secondary" className="text-xs">
                    +{dayTimes.length - 1} more
                  </Badge>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QuickTip() {
  return (
    <div className="bg-muted/50 flex items-start gap-2 rounded-md p-3 text-xs">
      <Info className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
      <div className="text-muted-foreground">
        <span className="font-medium">Pro Tip:</span> Consistency matters! Try posting at these
        optimal times for 2-3 weeks to maximize engagement. Results improve with more data.
      </div>
    </div>
  );
}

export function PostingScheduleOptimizer({ postingTimes, loading }: PostingScheduleOptimizerProps) {
  if (loading) {
    return <LoadingState />;
  }

  if (!postingTimes?.length) {
    return <EmptyState />;
  }

  return (
    <OptimizerCard showInfo>
      <div className="space-y-6">
        <TopRecommendations postingTimes={postingTimes} />
        <WeeklyScheduleOverview postingTimes={postingTimes} />
        <QuickTip />
      </div>
    </OptimizerCard>
  );
}
