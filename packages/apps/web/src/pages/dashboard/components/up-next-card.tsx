import { Link } from 'react-router-dom';
import { CalendarClock } from 'lucide-react';
import type { Content } from '@/lib/api';
import type { Asset } from '@/features/assets/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DashboardPostPreviewCard } from './dashboard-post-preview-card';

type UpNextCardProps = {
  isLoading: boolean;
  upcomingPosts: Content[];
  upcomingAssets?: Record<string, Asset | null>;
  brandTimezone?: string;
  onCreatePost: () => void;
};

export function UpNextCard({
  isLoading,
  upcomingPosts,
  upcomingAssets,
  brandTimezone,
  onCreatePost,
}: UpNextCardProps) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle>Up next</CardTitle>
          <p className="text-muted-foreground text-sm">Your next scheduled posts.</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/content">
            <CalendarClock className="mr-2 h-4 w-4" aria-hidden="true" />
            Calendar
          </Link>
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
        ) : upcomingPosts.length === 0 ? (
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              Nothing scheduled yet. Start a campaign or schedule a post to stay consistent.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to="/campaigns/create">Start Campaign</Link>
              </Button>
              <Button variant="outline" onClick={onCreatePost}>
                Create Post
              </Button>
              <Button asChild variant="ghost">
                <Link to="/drafts">View Drafts</Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {upcomingPosts.map((post) => {
              const primaryAsset = post.primaryAssetId
                ? (upcomingAssets?.[post.primaryAssetId] ?? null)
                : null;
              return (
                <DashboardPostPreviewCard
                  key={post.id}
                  post={post}
                  primaryAsset={primaryAsset}
                  brandTimezone={brandTimezone}
                  timestampLabel="Scheduled:"
                  timestamp={post.scheduledAt!}
                  actionLabel="Open"
                  actionTo={`/posts/${post.id}`}
                />
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
