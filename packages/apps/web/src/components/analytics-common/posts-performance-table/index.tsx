import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber, formatPercent } from '@/utils/formatNumber';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  Eye,
  Heart,
  MessageCircle,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  FileText,
} from 'lucide-react';

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

interface Post {
  publicationId: string;
  contentId: string;
  platform: string;
  caption: string;
  thumbnailUrl?: string;
  permalink?: string;
  publishedAt?: string;
  metrics: PostMetrics;
}

interface PostsPerformanceTableProps {
  posts: Post[];
  loading?: boolean;
  pagination?: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  onPageChange?: (offset: number) => void;
  onPostClick?: (contentId: string) => void;
}

export function PostsPerformanceTable({
  posts,
  loading,
  pagination,
  onPageChange,
  onPostClick,
}: PostsPerformanceTableProps) {
  const [sortBy, setSortBy] = useState<'publishedAt' | 'engagement' | 'reach' | 'engagementRate'>(
    'publishedAt'
  );
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4" aria-hidden="true" />
            <CardTitle>Posts Performance</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!posts || posts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4" aria-hidden="true" />
            <CardTitle>Posts Performance</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground py-8 text-center">
            <Eye className="mx-auto mb-3 h-12 w-12 opacity-30" />
            <p className="text-sm">No posts found</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Sort posts
  const sortedPosts = [...posts].sort((a, b) => {
    let aValue, bValue;
    if (sortBy === 'publishedAt') {
      aValue = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      bValue = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    } else {
      aValue = a.metrics[sortBy] || 0;
      bValue = b.metrics[sortBy] || 0;
    }
    return sortOrder === 'desc' ? bValue - aValue : aValue - bValue;
  });

  const formatDate = (dateStr?: string) => {
    if (!dateStr) {
      return 'N/A';
    }
    return new Date(dateStr).toLocaleDateString();
  };

  const handlePrevPage = () => {
    if (pagination && pagination.offset > 0 && onPageChange) {
      onPageChange(Math.max(0, pagination.offset - pagination.limit));
    }
  };

  const handleNextPage = () => {
    if (pagination && pagination.hasMore && onPageChange) {
      onPageChange(pagination.offset + pagination.limit);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5" aria-hidden="true" />
            <CardTitle>Posts Performance</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Select value={sortBy} onValueChange={(value: any) => setSortBy(value)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="publishedAt">Recent</SelectItem>
                <SelectItem value="engagement">Engagement</SelectItem>
                <SelectItem value="reach">Reach</SelectItem>
                <SelectItem value="engagementRate">Eng. Rate</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            >
              {sortOrder === 'desc' ? '↓' : '↑'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {/* Mobile: Card view */}
          <div className="block space-y-3 md:hidden">
            {sortedPosts.map((post) => (
              <div
                key={post.publicationId}
                className="hover:bg-muted/50 rounded-lg border p-3 transition-colors"
                onClick={() => onPostClick?.(post.contentId)}
                style={{ cursor: onPostClick ? 'pointer' : 'default' }}
              >
                <div className="mb-2 line-clamp-2 text-sm">{post.caption}</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1">
                    <Eye className="text-muted-foreground h-3 w-3" />
                    <span>{formatNumber(post.metrics.impressions)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Heart className="text-muted-foreground h-3 w-3" />
                    <span>{formatNumber(post.metrics.likes)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <MessageCircle className="text-muted-foreground h-3 w-3" />
                    <span>{formatNumber(post.metrics.comments)}</span>
                  </div>
                  <div className="text-muted-foreground">
                    {formatPercent(post.metrics.engagementRate)} rate
                  </div>
                </div>
                {post.publishedAt && (
                  <div className="text-muted-foreground mt-2 text-xs">
                    {formatDate(post.publishedAt)}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Desktop: Table view */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full">
              <thead className="border-b">
                <tr className="text-muted-foreground text-left text-xs">
                  <th className="pb-2 font-medium">Post</th>
                  <th className="pb-2 text-center font-medium">Published</th>
                  <th className="pb-2 text-right font-medium">Views</th>
                  <th className="pb-2 text-right font-medium">Reach</th>
                  <th className="pb-2 text-right font-medium">Likes</th>
                  <th className="pb-2 text-right font-medium">Comments</th>
                  <th className="pb-2 text-right font-medium">Saves</th>
                  <th className="pb-2 text-right font-medium">Eng. Rate</th>
                  <th className="pb-2 text-center font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedPosts.map((post) => (
                  <tr
                    key={post.publicationId}
                    className="hover:bg-muted/50 border-b transition-colors"
                  >
                    <td className="max-w-xs py-3">
                      <div className="line-clamp-2 text-sm">{post.caption}</div>
                    </td>
                    <td className="text-muted-foreground py-3 text-center text-xs">
                      {formatDate(post.publishedAt)}
                    </td>
                    <td className="py-3 text-right text-sm">
                      {formatNumber(post.metrics.impressions)}
                    </td>
                    <td className="py-3 text-right text-sm">{formatNumber(post.metrics.reach)}</td>
                    <td className="py-3 text-right text-sm">{formatNumber(post.metrics.likes)}</td>
                    <td className="py-3 text-right text-sm">
                      {formatNumber(post.metrics.comments)}
                    </td>
                    <td className="py-3 text-right text-sm">{formatNumber(post.metrics.saves)}</td>
                    <td className="py-3 text-right text-sm font-medium">
                      {formatPercent(post.metrics.engagementRate)}
                    </td>
                    <td className="py-3 text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onPostClick?.(post.contentId)}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination && (
            <div className="flex items-center justify-between pt-4">
              <div className="text-muted-foreground text-sm">
                Showing {pagination.offset + 1}-
                {Math.min(pagination.offset + pagination.limit, pagination.total)} of{' '}
                {pagination.total} posts
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrevPage}
                  disabled={pagination.offset === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleNextPage}
                  disabled={!pagination.hasMore}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
