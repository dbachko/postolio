import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatPercent } from '@/utils/formatNumber';
import type { StrategyPredictions, StrategyPredictionsMeta } from '../types';

interface ForecastCardProps {
  predictions: StrategyPredictions | null;
  predictionsMeta: StrategyPredictionsMeta | null;
}

export function ForecastCard({ predictions, predictionsMeta }: ForecastCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Forecast</CardTitle>
          <Badge variant={predictionsMeta?.basis === 'historical' ? 'default' : 'secondary'}>
            {predictionsMeta?.basis === 'historical' ? 'From data' : 'Heuristic'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="text-muted-foreground space-y-2 text-sm">
        {!predictions ? (
          <>
            <div className="bg-muted h-4 w-1/2 animate-pulse rounded" />
            <div className="bg-muted h-4 w-1/3 animate-pulse rounded" />
          </>
        ) : (
          <div className="space-y-2 text-sm">
            <div>Estimated posts: {predictions.estimatedPosts}</div>
            {predictionsMeta?.basis === 'historical' ? (
              <>
                <div>
                  Reach range: {predictions.reach.low.toLocaleString()} –{' '}
                  {predictions.reach.high.toLocaleString()}
                </div>
                <div>Engagement rate: {formatPercent(predictions.engagementRate * 100, 2)}</div>
                <div className="text-muted-foreground text-xs">
                  Based on your recent brand performance (samples: {predictionsMeta.samples.reach}{' '}
                  reach, {predictionsMeta.samples.engagement} engagement).
                </div>
              </>
            ) : (
              <div className="text-muted-foreground text-xs">
                We’ll calibrate reach and engagement after your first scheduled/published posts.
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
