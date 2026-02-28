import { useMemo, useState } from 'react';
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
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  FileText,
  Heart,
  MessageCircle,
} from 'lucide-react';
import {
  formatDate,
  type Post,
  type PostsPerformanceTableProps,
  type SortMetric,
  type SortOrder,
  sortPosts,
} from './helpers';

function PostsPerformanceLoading() {
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
          {[...Array(5)].map((_, index) => (
            <Skeleton key={index} className="h-16" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PostsPerformanceEmpty() {
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

function PostsPerformanceToolbar({
  sortBy,
  setSortBy,
  sortOrder,
  setSortOrder,
}: {
  sortBy: SortMetric;
  setSortBy: (value: SortMetric) => void;
  sortOrder: SortOrder;
  setSortOrder: (value: SortOrder) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <FileText className="h-5 w-5" aria-hidden="true" />
        <CardTitle>Posts Performance</CardTitle>
      </div>
      <div className="flex items-center gap-2">
        <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortMetric)}>
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
  );
}

function MobilePostsList({
  posts,
  onPostClick,
}: {
  posts: Post[];
  onPostClick?: (contentId: string) => void;
}) {
  return (
    <div className="block space-y-3 md:hidden">
      {posts.map((post) => (
        <div
          key={post.publicationId}
          className="hover:bg-muted/50 rounded-lg border p-3 transition-colors"
          onClick={() => onPostClick?.(post.contentId)}
          style={{ cursor: onPostClick ? 'pointer' : 'default' }}
        >
          <div className="mb-2 line-clamp-2 text-sm">{post.caption}</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <MetricCell
              icon={<Eye className="text-muted-foreground h-3 w-3" />}
              value={formatNumber(post.metrics.impressions)}
            />
            <MetricCell
              icon={<Heart className="text-muted-foreground h-3 w-3" />}
              value={formatNumber(post.metrics.likes)}
            />
            <MetricCell
              icon={<MessageCircle className="text-muted-foreground h-3 w-3" />}
              value={formatNumber(post.metrics.comments)}
            />
            <div className="text-muted-foreground">
              {formatPercent(post.metrics.engagementRate)} rate
            </div>
          </div>
          {post.publishedAt ? (
            <div className="text-muted-foreground mt-2 text-xs">{formatDate(post.publishedAt)}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function MetricCell({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <div className="flex items-center gap-1">
      {icon}
      <span>{value}</span>
    </div>
  );
}

function DesktopPostsTable({
  posts,
  onPostClick,
}: {
  posts: Post[];
  onPostClick?: (contentId: string) => void;
}) {
  return (
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
          {posts.map((post) => (
            <tr key={post.publicationId} className="hover:bg-muted/50 border-b transition-colors">
              <td className="max-w-xs py-3">
                <div className="line-clamp-2 text-sm">{post.caption}</div>
              </td>
              <td className="text-muted-foreground py-3 text-center text-xs">
                {formatDate(post.publishedAt)}
              </td>
              <td className="py-3 text-right text-sm">{formatNumber(post.metrics.impressions)}</td>
              <td className="py-3 text-right text-sm">{formatNumber(post.metrics.reach)}</td>
              <td className="py-3 text-right text-sm">{formatNumber(post.metrics.likes)}</td>
              <td className="py-3 text-right text-sm">{formatNumber(post.metrics.comments)}</td>
              <td className="py-3 text-right text-sm">{formatNumber(post.metrics.saves)}</td>
              <td className="py-3 text-right text-sm font-medium">
                {formatPercent(post.metrics.engagementRate)}
              </td>
              <td className="py-3 text-center">
                <Button variant="ghost" size="sm" onClick={() => onPostClick?.(post.contentId)}>
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PaginationControls({
  pagination,
  onPageChange,
}: {
  pagination: NonNullable<PostsPerformanceTableProps['pagination']>;
  onPageChange?: (offset: number) => void;
}) {
  const handlePrevPage = () => {
    if (pagination.offset > 0 && onPageChange) {
      onPageChange(Math.max(0, pagination.offset - pagination.limit));
    }
  };
  const handleNextPage = () => {
    if (pagination.hasMore && onPageChange) {
      onPageChange(pagination.offset + pagination.limit);
    }
  };
  return (
    <div className="flex items-center justify-between pt-4">
      <div className="text-muted-foreground text-sm">
        Showing {pagination.offset + 1}-
        {Math.min(pagination.offset + pagination.limit, pagination.total)} of {pagination.total}{' '}
        posts
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
        <Button variant="outline" size="sm" onClick={handleNextPage} disabled={!pagination.hasMore}>
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function PostsPerformanceTable({
  posts,
  loading,
  pagination,
  onPageChange,
  onPostClick,
}: PostsPerformanceTableProps) {
  const [sortBy, setSortBy] = useState<SortMetric>('publishedAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const sortedPosts = useMemo(
    () => sortPosts(posts, sortBy, sortOrder),
    [posts, sortBy, sortOrder]
  );

  if (loading) {
    return <PostsPerformanceLoading />;
  }
  if (!posts || posts.length === 0) {
    return <PostsPerformanceEmpty />;
  }

  return (
    <Card>
      <CardHeader>
        <PostsPerformanceToolbar
          sortBy={sortBy}
          setSortBy={setSortBy}
          sortOrder={sortOrder}
          setSortOrder={setSortOrder}
        />
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <MobilePostsList posts={sortedPosts} onPostClick={onPostClick} />
          <DesktopPostsTable posts={sortedPosts} onPostClick={onPostClick} />
          {pagination ? (
            <PaginationControls pagination={pagination} onPageChange={onPageChange} />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
