import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import type { Content } from '@/lib/api';
import type { Asset } from '@/features/assets/api/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DashboardPostPreviewCard } from './dashboard-post-preview-card';

type NeedsAttentionCardProps = {
  isLoading: boolean;
  instagramDisconnected: boolean;
  failedPosts: Content[];
  failedPreviewPosts: Content[];
  failedPreviewAssets?: Record<string, Asset | null>;
  needsAttentionCount: number;
  brandTimezone?: string;
};

export function NeedsAttentionCard({
  isLoading,
  instagramDisconnected,
  failedPosts,
  failedPreviewPosts,
  failedPreviewAssets,
  needsAttentionCount,
  brandTimezone,
}: NeedsAttentionCardProps) {
  return (
    <Card id="needs-attention" className="lg:col-span-2">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle>Needs attention</CardTitle>
          <p className="text-muted-foreground text-sm">
            Fix these first to avoid missed posts and lost engagement.
          </p>
        </div>
        <Button variant="outline" asChild size="sm">
          <Link to="/notifications">View alerts</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
                <Skeleton className="h-8 w-20" />
              </div>
            ))}
          </div>
        ) : (
          <>
            {instagramDisconnected ? (
              <Alert variant="warning">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                <div>
                  <AlertTitle>Instagram disconnected</AlertTitle>
                  <AlertDescription>
                    Reconnect your account to publish and sync data.
                    <div className="mt-2">
                      <Button asChild size="sm">
                        <Link to="/brands">Reconnect</Link>
                      </Button>
                    </div>
                  </AlertDescription>
                </div>
              </Alert>
            ) : null}

            {failedPosts.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">Failed posts</h3>
                    <Badge variant="destructive">{failedPosts.length}</Badge>
                  </div>
                  <Button asChild variant="ghost" size="sm" className="gap-1">
                    <Link to="/content">
                      View calendar <span aria-hidden="true">→</span>
                    </Link>
                  </Button>
                </div>

                <div className="space-y-2">
                  {failedPreviewPosts.map((post) => {
                    const primaryAsset = post.primaryAssetId
                      ? (failedPreviewAssets?.[post.primaryAssetId] ?? null)
                      : null;

                    return (
                      <DashboardPostPreviewCard
                        key={post.id}
                        post={post}
                        primaryAsset={primaryAsset}
                        brandTimezone={brandTimezone}
                        timestampLabel="Last updated:"
                        timestamp={post.updatedAt}
                        actionLabel="Review"
                        actionTo={`/posts/${post.id}`}
                      />
                    );
                  })}

                  {failedPosts.length > 3 ? (
                    <p className="text-muted-foreground text-xs">
                      And {failedPosts.length - 3} more failed post
                      {failedPosts.length - 3 === 1 ? '' : 's'}.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {needsAttentionCount === 0 ? (
              <Alert variant="success">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                <div>
                  <AlertTitle>All clear</AlertTitle>
                  <AlertDescription>No failures or disconnects detected.</AlertDescription>
                </div>
              </Alert>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
