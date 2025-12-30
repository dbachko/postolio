import { RefreshCw } from 'lucide-react';

import type { PostInsights } from '../types';
import { MetricsGrid } from './metrics-grid';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProfileAvatar } from '@/components/ui/profile-avatar';

type PostPerformanceCardProps = {
  insights?: PostInsights;
  comments: { username: string; text: string }[];
  selectedPublicationId?: string;
  onRefreshMetrics?: () => void;
  onRefreshComments?: () => void;
};

export function PostPerformanceCard({
  insights,
  comments,
  selectedPublicationId,
  onRefreshMetrics,
  onRefreshComments,
}: PostPerformanceCardProps) {
  return (
    <Card className="p-4 md:p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold md:text-lg">Performance</h3>
        {selectedPublicationId ? (
          <Button variant="outline" size="sm" onClick={onRefreshMetrics}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        ) : null}
      </div>

      <Tabs defaultValue="metrics" className="mt-4">
        <TabsList>
          <TabsTrigger value="metrics">Metrics</TabsTrigger>
          <TabsTrigger value="comments">Comments</TabsTrigger>
        </TabsList>

        <TabsContent value="metrics" className="mt-4">
          {insights ? (
            <MetricsGrid insights={insights} />
          ) : (
            <p className="text-muted-foreground py-6 text-center text-sm">
              Metrics may take a few minutes to appear after publishing. Use Refresh to request an
              update.
            </p>
          )}
        </TabsContent>

        <TabsContent value="comments" className="mt-4">
          {(() => {
            if (comments.length > 0) {
              return (
                <div className="max-h-[360px] space-y-3 overflow-y-auto">
                  {comments.map((comment, index) => (
                    <div key={index} className="bg-muted flex items-start gap-3 rounded-lg p-3">
                      <div className="mt-0.5">
                        <ProfileAvatar name={comment.username} size="sm" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{comment.username}</p>
                        <p className="text-foreground mt-1 text-sm">{comment.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              );
            }

            if (insights && insights.metrics.comments_count > 0 && selectedPublicationId) {
              return (
                <div className="text-muted-foreground flex flex-col items-center gap-3 py-6 text-center text-sm">
                  <p>
                    {insights.metrics.comments_count.toLocaleString()} comment
                    {insights.metrics.comments_count === 1 ? '' : 's'} on Instagram. They may not be
                    synced yet.
                  </p>
                  <Button variant="outline" size="sm" onClick={onRefreshComments}>
                    <RefreshCw className="mr-2 h-4 w-4" /> Refresh Comments
                  </Button>
                </div>
              );
            }

            return (
              <p className="text-muted-foreground py-6 text-center text-sm">No comments yet</p>
            );
          })()}
        </TabsContent>
      </Tabs>
    </Card>
  );
}
