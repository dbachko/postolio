import { memo } from 'react';

import type { PostInsights } from '../types';

type MetricsGridProps = {
  insights: PostInsights;
};

export const MetricsGrid = memo(function MetricsGrid({ insights }: MetricsGridProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="bg-muted rounded-lg p-3">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs">Likes</span>
        </div>
        <p className="mt-1 text-lg font-bold">{insights.metrics.likes_count.toLocaleString()}</p>
      </div>

      <div className="bg-muted rounded-lg p-3">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs">Comments</span>
        </div>
        <p className="mt-1 text-lg font-bold">{insights.metrics.comments_count.toLocaleString()}</p>
      </div>

      <div className="bg-muted rounded-lg p-3">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs">Reach</span>
        </div>
        <p className="mt-1 text-lg font-bold">{insights.metrics.reach.toLocaleString()}</p>
      </div>

      <div className="bg-muted rounded-lg p-3">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs">Shares</span>
        </div>
        <p className="mt-1 text-lg font-bold">{insights.metrics.shares.toLocaleString()}</p>
      </div>
    </div>
  );
});
