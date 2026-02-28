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

function getInsightIcon(type: InsightType) {
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
}

function getPriorityBadge(priority: InsightPriority) {
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
    default:
      return null;
  }
}

function InsightTrendIcon({ trend }: { trend?: 'up' | 'down' | 'stable' }) {
  if (!trend || trend === 'stable') {
    return null;
  }
  if (trend === 'up') {
    return <TrendingUp className="text-primary h-3 w-3" />;
  }
  return <AlertCircle className="text-destructive h-3 w-3" />;
}

function InsightsLoadingState() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          <span>AI Insights</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {[...Array(3)].map((_, index) => (
            <div key={index} className="flex gap-3">
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

function InsightsEmptyState() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="text-primary h-5 w-5" />
          <span>AI Insights</span>
          <Badge variant="secondary" className="ml-auto text-xs">
            Preview
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="py-8 text-center">
          <div className="bg-muted mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
            <Sparkles className="text-primary h-8 w-8" />
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

function InsightCard({
  insight,
  expandedInsight,
  setExpandedInsight,
  onInsightClick,
}: {
  insight: Insight;
  expandedInsight: string | null;
  setExpandedInsight: (insightId: string | null) => void;
  onInsightClick?: (insight: Insight) => void;
}) {
  const Icon = getInsightIcon(insight.type);
  const isExpanded = expandedInsight === insight.id;

  return (
    <div className="border-border/50 bg-card/50 group rounded-lg border p-4 backdrop-blur-sm transition-all hover:shadow-md">
      <div className="flex items-start gap-3">
        <div className="bg-muted text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
          <Icon className="h-5 w-5" />
        </div>

        <div className="flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="mb-1 flex items-center gap-2">
                <h4 className="leading-tight font-semibold">{insight.title}</h4>
                {getPriorityBadge(insight.priority)}
              </div>
              <p className="text-muted-foreground text-sm">{insight.description}</p>
            </div>

            {insight.supportingData?.length ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={() => setExpandedInsight(isExpanded ? null : insight.id)}
                aria-label={isExpanded ? 'Collapse insight details' : 'Expand insight details'}
                aria-expanded={isExpanded}
                className="text-muted-foreground hover:text-foreground shrink-0 transition-transform"
              >
                <ChevronRight
                  className={`h-5 w-5 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                />
              </Button>
            ) : null}
          </div>

          {insight.priority === 'high' && insight.impact ? (
            <div className="bg-muted rounded-md px-3 py-1.5 text-xs">
              <span className="font-medium">Impact:</span> {insight.impact}
            </div>
          ) : null}

          {isExpanded && insight.supportingData?.length ? (
            <div className="border-border/50 space-y-2 border-t pt-3">
              {insight.supportingData.map((data, index) => (
                <div key={index} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{data.metric}</span>
                  <div className="flex items-center gap-1.5 font-medium">
                    <span>{data.value}</span>
                    <InsightTrendIcon trend={data.trend} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {insight.actionable && insight.action ? (
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs"
              onClick={() => onInsightClick?.(insight)}
            >
              {insight.action.label}
              <ChevronRight className="ml-1 h-3 w-3" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function InsightsPanel({ insights, loading, onInsightClick }: InsightsPanelProps) {
  const [expandedInsight, setExpandedInsight] = useState<string | null>(null);
  const visibleInsights = insights && insights.length > 0 ? insights.slice(0, 5) : [];

  if (loading) {
    return <InsightsLoadingState />;
  }

  if (visibleInsights.length === 0) {
    return <InsightsEmptyState />;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="text-primary h-5 w-5" />
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
            return (
              <InsightCard
                key={insight.id}
                insight={insight}
                expandedInsight={expandedInsight}
                setExpandedInsight={setExpandedInsight}
                onInsightClick={onInsightClick}
              />
            );
          })}
        </div>

        {insights && insights.length > 5 && (
          <div className="mt-4 text-center">
            <Button type="button" variant="link" className="h-auto p-0 text-sm">
              View all {insights.length} insights →
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
