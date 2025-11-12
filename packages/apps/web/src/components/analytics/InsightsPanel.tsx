import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sparkles,
  TrendingUp,
  Clock,
  Hash,
  Users,
  Target,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';

type InsightType = 'performance' | 'timing' | 'content' | 'audience' | 'competitive';
type InsightPriority = 'high' | 'medium' | 'low';

interface Insight {
  id: string;
  type: InsightType;
  priority: InsightPriority;
  title: string;
  description: string;
  impact: string;
  actionable: boolean;
  action?: {
    label: string;
    type: string;
    data?: any;
  };
  supportingData?: Array<{
    metric: string;
    value: number | string;
    change?: number;
    trend?: 'up' | 'down' | 'stable';
  }>;
  timestamp: Date;
}

interface InsightsPanelProps {
  insights?: Insight[];
  loading?: boolean;
  onInsightClick?: (insight: Insight) => void;
}

export function InsightsPanel({ insights, loading, onInsightClick }: InsightsPanelProps) {
  const [expandedInsight, setExpandedInsight] = useState<string | null>(null);

  if (loading) {
    return (
      <Card className="bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-950 dark:to-blue-950">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            <span>AI Insights</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-6 w-6 shrink-0 rounded" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const visibleInsights = insights && insights.length > 0 ? insights.slice(0, 5) : [];

  if (visibleInsights.length === 0) {
    return (
      <Card className="border-none bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 shadow-lg dark:from-purple-950 dark:via-blue-950 dark:to-indigo-950">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            <span>AI Insights</span>
            <Badge variant="secondary" className="ml-auto text-xs">
              Preview
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="py-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900/30">
              <Sparkles className="h-8 w-8 text-purple-600 dark:text-purple-400" />
            </div>
            <p className="mb-2 text-sm font-medium">Start Building Your Analytics Foundation</p>
            <p className="text-muted-foreground text-xs">
              Publish at least 10 posts to unlock personalized AI-powered insights
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getInsightIcon = (type: InsightType) => {
    switch (type) {
      case 'performance':
        return TrendingUp;
      case 'timing':
        return Clock;
      case 'content':
        return Hash;
      case 'audience':
        return Users;
      case 'competitive':
        return Target;
      default:
        return Sparkles;
    }
  };

  const getInsightIconColor = (type: InsightType) => {
    switch (type) {
      case 'performance':
        return 'text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30';
      case 'timing':
        return 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30';
      case 'content':
        return 'text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/30';
      case 'audience':
        return 'text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30';
      case 'competitive':
        return 'text-pink-600 dark:text-pink-400 bg-pink-100 dark:bg-pink-900/30';
      default:
        return 'text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-900/30';
    }
  };

  const getPriorityBadge = (priority: InsightPriority) => {
    switch (priority) {
      case 'high':
        return (
          <Badge variant="destructive" className="text-xs">
            High Priority
          </Badge>
        );
      case 'medium':
        return (
          <Badge variant="secondary" className="text-xs">
            Medium
          </Badge>
        );
      case 'low':
        return (
          <Badge variant="outline" className="text-xs">
            Low
          </Badge>
        );
    }
  };

  const getTrendIcon = (trend?: 'up' | 'down' | 'stable') => {
    if (!trend) return null;

    const className =
      trend === 'up'
        ? 'h-3 w-3 text-green-600 dark:text-green-400'
        : trend === 'down'
          ? 'h-3 w-3 text-red-600 dark:text-red-400'
          : 'h-3 w-3 text-gray-600 dark:text-gray-400';

    return trend === 'up' ? (
      <TrendingUp className={className} />
    ) : trend === 'down' ? (
      <AlertCircle className={className} />
    ) : null;
  };

  return (
    <Card className="border-none bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 shadow-lg dark:from-purple-950 dark:via-blue-950 dark:to-indigo-950">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            <span>AI Insights</span>
          </CardTitle>
          <Badge variant="secondary" className="text-xs">
            {visibleInsights.length} {visibleInsights.length === 1 ? 'Insight' : 'Insights'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {visibleInsights.map((insight) => {
            const Icon = getInsightIcon(insight.type);
            const isExpanded = expandedInsight === insight.id;

            return (
              <div
                key={insight.id}
                className="border-border/50 bg-card/50 group rounded-lg border p-4 backdrop-blur-sm transition-all hover:shadow-md"
              >
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${getInsightIconColor(insight.type)}`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 space-y-2">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="mb-1 flex items-center gap-2">
                          <h4 className="font-semibold leading-tight">{insight.title}</h4>
                          {getPriorityBadge(insight.priority)}
                        </div>
                        <p className="text-muted-foreground text-sm">{insight.description}</p>
                      </div>

                      {/* Expand button */}
                      {insight.supportingData && insight.supportingData.length > 0 && (
                        <button
                          onClick={() => setExpandedInsight(isExpanded ? null : insight.id)}
                          className="text-muted-foreground hover:text-foreground transition-transform"
                        >
                          <ChevronRight
                            className={`h-5 w-5 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                          />
                        </button>
                      )}
                    </div>

                    {/* Impact (only for high priority) */}
                    {insight.priority === 'high' && insight.impact && (
                      <div className="rounded-md bg-purple-100/50 px-3 py-1.5 text-xs dark:bg-purple-900/20">
                        <span className="font-medium">Impact:</span> {insight.impact}
                      </div>
                    )}

                    {/* Supporting Data (expanded) */}
                    {isExpanded && insight.supportingData && insight.supportingData.length > 0 && (
                      <div className="border-border/50 space-y-2 border-t pt-3">
                        {insight.supportingData.map((data, idx) => (
                          <div key={idx} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">{data.metric}</span>
                            <div className="flex items-center gap-1.5 font-medium">
                              <span>{data.value}</span>
                              {getTrendIcon(data.trend)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Action button */}
                    {insight.actionable && insight.action && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full text-xs"
                        onClick={() => onInsightClick?.(insight)}
                      >
                        {insight.action.label}
                        <ChevronRight className="ml-1 h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* View all insights link */}
        {insights && insights.length > 5 && (
          <div className="mt-4 text-center">
            <button className="text-sm font-medium text-purple-600 hover:underline dark:text-purple-400">
              View all {insights.length} insights →
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
