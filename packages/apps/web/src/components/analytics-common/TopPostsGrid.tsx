import { useState } from 'react';
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
import { getPlatformIcon } from '@/lib/platform-icons';

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

export function TopPostsGrid({ posts, loading, onPostClick }: TopPostsGridProps) {
  const [sortBy, setSortBy] = useState<SortOption>('engagementRate');

  if (loading) {
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

  if (posts.length === 0) {
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

  // Sort posts
  const sortedPosts = [...posts].sort((a, b) => {
    const aValue = a.metrics[sortBy] || 0;
    const bValue = b.metrics[sortBy] || 0;
    return bValue - aValue;
  });

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
            <div
              key={post.publicationId}
              className="bg-card group relative overflow-hidden rounded-lg border shadow-sm transition-all duration-200 hover:shadow-lg"
              onClick={() => onPostClick?.(post.contentId)}
              style={{ cursor: onPostClick ? 'pointer' : 'default' }}
            >
              {/* Thumbnail placeholder */}
              {post.thumbnailUrl ? (
                <img
                  src={post.thumbnailUrl}
                  alt="Post thumbnail"
                  className="h-48 w-full object-cover"
                />
              ) : (
                <div className="bg-muted flex h-48 w-full items-center justify-center">
                  <Eye className="text-muted-foreground h-12 w-12 opacity-30" />
                </div>
              )}

              {/* Engagement rate badge */}
              <div className="absolute top-2 right-2">
                <Badge
                  variant="secondary"
                  className="bg-background/90 text-foreground font-semibold shadow-lg backdrop-blur-sm"
                >
                  {formatPercent(post.metrics.engagementRate)}
                </Badge>
              </div>

              {/* Platform icon */}
              <div className="absolute top-2 left-2">
                <div className="bg-background/90 flex h-8 w-8 items-center justify-center rounded-full shadow-lg backdrop-blur-sm">
                  {getPlatformIcon(post.platform)}
                </div>
              </div>

              {/* Post info */}
              <div className="p-4">
                {/* Caption preview */}
                {post.caption && (
                  <p className="text-muted-foreground mb-3 line-clamp-2 text-sm">{post.caption}</p>
                )}

                {/* Metrics */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1">
                    <Eye className="text-muted-foreground h-3.5 w-3.5" />
                    <span className="font-medium">{formatNumber(post.metrics.impressions)}</span>
                    <span className="text-muted-foreground">views</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Heart className="text-muted-foreground h-3.5 w-3.5" />
                    <span className="font-medium">{formatNumber(post.metrics.likes)}</span>
                    <span className="text-muted-foreground">likes</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <MessageCircle className="text-muted-foreground h-3.5 w-3.5" />
                    <span className="font-medium">{formatNumber(post.metrics.comments)}</span>
                    <span className="text-muted-foreground">comments</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Bookmark className="text-muted-foreground h-3.5 w-3.5" />
                    <span className="font-medium">{formatNumber(post.metrics.saves)}</span>
                    <span className="text-muted-foreground">saves</span>
                  </div>
                </div>

                {/* Published date */}
                {post.publishedAt && (
                  <div className="text-muted-foreground mt-3 text-xs">
                    {new Date(post.publishedAt).toLocaleDateString()}
                  </div>
                )}
              </div>

              {/* Hover overlay */}
              {onPostClick && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  <span className="text-sm font-medium text-white">View Details →</span>
                </div>
              )}
            </div>
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
