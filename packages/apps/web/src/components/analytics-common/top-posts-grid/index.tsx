import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatNumber, formatPercent } from '@/utils/formatNumber';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Eye, Heart, MessageCircle, Bookmark } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { getPlatformIcon } from '@/components/icons/platform-icons';

interface PostMetrics {
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  engagement: number;
  engagementRate: number;
}

interface TopPost {
  publicationId: string;
  contentId: string;
  platform: string;
  permalink?: string;
  publishedAt?: string;
  metrics: PostMetrics;
  thumbnailUrl?: string;
  caption?: string;
}

interface TopPostsGridProps {
  posts: TopPost[];
  loading?: boolean;
  onPostClick?: (postId: string) => void;
}

type SortOption = 'engagementRate' | 'engagement' | 'reach' | 'impressions';

function TopPostsLoadingState() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Top Performing Posts</CardTitle>
          <Skeleton className="h-10 w-40" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-lg" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TopPostsEmptyState() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Performing Posts</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-muted-foreground py-12 text-center">
          <div className="mb-4">
            <Eye className="mx-auto h-12 w-12 opacity-50" />
          </div>
          <p className="text-sm">No posts data available yet</p>
          <p className="text-xs">Start publishing content to see top performers</p>
        </div>
      </CardContent>
    </Card>
  );
}

function TopPostCard({
  post,
  onPostClick,
}: {
  post: TopPost;
  onPostClick?: (postId: string) => void;
}) {
  return (
    <div
      className="bg-card group relative overflow-hidden rounded-lg border shadow-sm transition-all duration-200 hover:shadow-lg"
      onClick={() => onPostClick?.(post.contentId)}
      style={{ cursor: onPostClick ? 'pointer' : 'default' }}
    >
      {post.thumbnailUrl ? (
        <img src={post.thumbnailUrl} alt="Post thumbnail" className="h-48 w-full object-cover" />
      ) : (
        <div className="bg-muted flex h-48 w-full items-center justify-center">
          <Eye className="text-muted-foreground h-12 w-12 opacity-30" />
        </div>
      )}
      <div className="absolute top-2 right-2">
        <Badge
          variant="secondary"
          className="bg-background/90 text-foreground font-semibold shadow-lg backdrop-blur-sm"
        >
          {formatPercent(post.metrics.engagementRate)}
        </Badge>
      </div>
      <div className="absolute top-2 left-2">
        <div className="bg-background/90 flex h-8 w-8 items-center justify-center rounded-full shadow-lg backdrop-blur-sm">
          {getPlatformIcon(post.platform)}
        </div>
      </div>
      <div className="p-4">
        {post.caption && (
          <p className="text-muted-foreground mb-3 line-clamp-2 text-sm">{post.caption}</p>
        )}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <MetricRow icon={Eye} label="views" value={post.metrics.impressions} />
          <MetricRow icon={Heart} label="likes" value={post.metrics.likes} />
          <MetricRow icon={MessageCircle} label="comments" value={post.metrics.comments} />
          <MetricRow icon={Bookmark} label="saves" value={post.metrics.saves} />
        </div>
        {post.publishedAt && (
          <div className="text-muted-foreground mt-3 text-xs">
            {new Date(post.publishedAt).toLocaleDateString()}
          </div>
        )}
      </div>
      {onPostClick && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <span className="text-sm font-medium text-white">View Details →</span>
        </div>
      )}
    </div>
  );
}

function MetricRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Eye;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-1">
      <Icon className="text-muted-foreground h-3.5 w-3.5" />
      <span className="font-medium">{formatNumber(value)}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

export function TopPostsGrid({ posts, loading, onPostClick }: TopPostsGridProps) {
  const [sortBy, setSortBy] = useState<SortOption>('engagementRate');
  const sortedPosts = useMemo(() => {
    return [...posts].sort((a, b) => (b.metrics[sortBy] || 0) - (a.metrics[sortBy] || 0));
  }, [posts, sortBy]);

  if (loading) {
    return <TopPostsLoadingState />;
  }
  if (posts.length === 0) {
    return <TopPostsEmptyState />;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Top Performing Posts</CardTitle>
          <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortOption)}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Sort by..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="engagementRate">Engagement Rate</SelectItem>
              <SelectItem value="engagement">Total Engagement</SelectItem>
              <SelectItem value="reach">Reach</SelectItem>
              <SelectItem value="impressions">Views</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sortedPosts.slice(0, 6).map((post) => (
            <TopPostCard key={post.publicationId} post={post} onPostClick={onPostClick} />
          ))}
        </div>
        {sortedPosts.length > 6 && (
          <div className="text-muted-foreground mt-4 text-center text-sm">
            Showing top 6 of {sortedPosts.length} posts
          </div>
        )}
      </CardContent>
    </Card>
  );
}
