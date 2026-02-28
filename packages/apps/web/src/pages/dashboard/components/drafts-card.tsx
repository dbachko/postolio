import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Content } from '@/lib/api';
import type { Asset } from '@/features/assets/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DashboardPostPreviewCard } from './dashboard-post-preview-card';

type DraftsCardProps = {
  isLoading: boolean;
  drafts: Content[];
  unscheduledDrafts: Content[];
  draftPreviewDrafts: Content[];
  draftPreviewAssets?: Record<string, Asset | null>;
  brandTimezone?: string;
  onCreatePost: () => void;
};

export function DraftsCard({
  isLoading,
  drafts,
  unscheduledDrafts,
  draftPreviewDrafts,
  draftPreviewAssets,
  brandTimezone,
  onCreatePost,
}: DraftsCardProps) {
  let body: ReactNode;
  if (isLoading) {
    body = (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-md" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
            <Skeleton className="h-8 w-16" />
          </div>
        ))}
      </div>
    );
  } else if (drafts.length === 0) {
    body = (
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">No drafts yet.</p>
        <Button onClick={onCreatePost}>Create your first post</Button>
      </div>
    );
  } else {
    body = (
      <>
        <div className="flex items-center gap-2">
          <Badge variant={unscheduledDrafts.length > 0 ? 'info' : 'secondary'}>
            {unscheduledDrafts.length} unscheduled
          </Badge>
          <Badge variant="secondary">{drafts.length} total</Badge>
        </div>
        <div className="space-y-2">
          {draftPreviewDrafts.map((draft) => {
            const primaryAsset = draft.primaryAssetId
              ? (draftPreviewAssets?.[draft.primaryAssetId] ?? null)
              : null;

            return (
              <DashboardPostPreviewCard
                key={draft.id}
                post={draft}
                primaryAsset={primaryAsset}
                brandTimezone={brandTimezone}
                timestampLabel="Last updated:"
                timestamp={draft.updatedAt}
                actionLabel="Open"
                actionTo={`/posts/${draft.id}`}
              />
            );
          })}
        </div>
      </>
    );
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle>Drafts</CardTitle>
          <p className="text-muted-foreground text-sm">Quick wins you can schedule anytime.</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/drafts">Open drafts</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">{body}</CardContent>
    </Card>
  );
}
