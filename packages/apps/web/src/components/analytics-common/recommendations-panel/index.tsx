import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Hash,
  Lightbulb,
  Sparkles,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import type { RecommendationsPanelProps } from './types';
import { getDifficultyColorClassName, getImpactBadgeConfig, getRecommendationIcon } from './utils';

export function RecommendationsPanel({
  recommendations,
  loading,
  onViewHashtags,
  onViewSchedule,
}: RecommendationsPanelProps) {
  const [expandedRecommendation, setExpandedRecommendation] = useState<string | null>(null);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="text-primary h-5 w-5" />
            <CardTitle>Smart Recommendations</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!recommendations || !recommendations.contentOptimizations?.length) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="text-primary h-5 w-5" />
            <CardTitle>Smart Recommendations</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground py-12 text-center">
            <div className="mb-4">
              <Lightbulb className="mx-auto h-12 w-12 opacity-50" />
            </div>
            <p className="text-sm">Not enough data for recommendations</p>
            <p className="text-xs">Publish at least 10 posts to unlock AI-powered suggestions</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { contentOptimizations = [], hashtags = [], postingTimes = [], summary } = recommendations;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="text-primary h-5 w-5" />
            <CardTitle>Smart Recommendations</CardTitle>
          </div>
          {summary && (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Badge variant="outline" className="font-normal">
                {summary.totalRecommendations} total
              </Badge>
              {summary.highImpactCount > 0 && (
                <Badge
                  variant="default"
                  className="bg-red-500 font-normal text-white dark:bg-red-600"
                >
                  {summary.highImpactCount} high priority
                </Badge>
              )}
            </div>
          )}
        </div>
        {summary && (
          <div className="text-muted-foreground mt-2 flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1">
              <span>Difficulty:</span>
              <span
                className={`font-medium capitalize ${getDifficultyColorClassName(
                  summary.implementationDifficulty
                )}`}
              >
                {summary.implementationDifficulty}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span>Est. Impact:</span>
              <span className="font-medium text-green-600 dark:text-green-400">
                {summary.estimatedImpact}
              </span>
            </div>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="space-y-3">
            {contentOptimizations.map((rec, index) => {
              const Icon = getRecommendationIcon(rec.type);
              const isExpanded = expandedRecommendation === `content-${index}`;
              const impactBadge = getImpactBadgeConfig(rec.impact);
              let impactIconClassName =
                'bg-gray-100 text-gray-600 dark:bg-gray-950/30 dark:text-gray-400';
              if (rec.impact === 'high') {
                impactIconClassName =
                  'bg-red-100 text-red-600 dark:bg-red-950/30 dark:text-red-400';
              } else if (rec.impact === 'medium') {
                impactIconClassName =
                  'bg-yellow-100 text-yellow-600 dark:bg-yellow-950/30 dark:text-yellow-400';
              }

              return (
                <div
                  key={index}
                  className="border-border/50 bg-card/50 hover:border-border rounded-lg border transition-all"
                >
                  <button
                    onClick={() =>
                      setExpandedRecommendation(isExpanded ? null : `content-${index}`)
                    }
                    className="w-full p-4 text-left"
                    aria-label={`${isExpanded ? 'Collapse' : 'Expand'} recommendation: ${rec.title}`}
                    aria-expanded={isExpanded}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${impactIconClassName}`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <h4 className="text-sm font-semibold">{rec.title}</h4>
                          <div className="flex items-center gap-2">
                            <Badge variant={impactBadge.variant} className={impactBadge.className}>
                              {impactBadge.label}
                            </Badge>
                            <ChevronRight
                              className={`text-muted-foreground h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            />
                          </div>
                        </div>

                        <p className="text-muted-foreground text-sm">{rec.description}</p>

                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          <div className="bg-muted/50 flex items-center gap-1 rounded-md px-2 py-1">
                            <span className="text-muted-foreground">Current:</span>
                            <span className="font-medium">{rec.currentValue}</span>
                          </div>
                          <div className="bg-primary/10 flex items-center gap-1 rounded-md px-2 py-1">
                            <span className="text-muted-foreground">Recommended:</span>
                            <span className="text-primary font-medium">{rec.recommendedValue}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-border/50 bg-muted/30 space-y-3 border-t p-4">
                      <div className="text-muted-foreground text-xs">
                        <div className="mb-1 font-medium">Evidence:</div>
                        <div>{rec.evidence}</div>
                      </div>

                      <div className="text-xs">
                        <div className="mb-2 font-medium">Action Items:</div>
                        <ul className="space-y-1.5">
                          {rec.actionItems.map((action, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />
                              <span className="text-muted-foreground">{action}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-3 border-t pt-2 sm:grid-cols-2">
            {hashtags && hashtags.length > 0 && (
              <Button variant="outline" className="justify-between" onClick={onViewHashtags}>
                <div className="flex items-center gap-2">
                  <Hash className="h-4 w-4" />
                  <span>Hashtag Recommendations</span>
                </div>
                <Badge variant="secondary">{hashtags.length}</Badge>
              </Button>
            )}

            {postingTimes && postingTimes.length > 0 && (
              <Button variant="outline" className="justify-between" onClick={onViewSchedule}>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  <span>Optimal Posting Times</span>
                </div>
                <Badge variant="secondary">{postingTimes.length}</Badge>
              </Button>
            )}
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs dark:border-blue-900 dark:bg-blue-950/30">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
            <div className="text-blue-900 dark:text-blue-100">
              <span className="font-medium">AI-Powered Analysis:</span> These recommendations are
              based on your historical performance data. Implementing them can help improve your
              engagement rates.
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
