import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TabsContent } from '@/components/ui/tabs';
import { PostsPerformanceTable } from '@/components/analytics-common/posts-performance-table';
import { TopPostsGrid } from '@/components/analytics-common/top-posts-grid';

import type { AnalyticsPostsData, AnalyticsPostsSortBy } from '../types';

interface PostsTabContentProps extends AnalyticsPostsData {
  onSortByChange: (value: AnalyticsPostsSortBy) => void;
  onOrderToggle: () => void;
  onPageChange: (offset: number) => void;
  onPostClick: (contentId: string) => void;
}

export function PostsTabContent({
  topPosts,
  topPostsLoading,
  posts,
  postsLoading,
  pagination,
  sortBy,
  order,
  onSortByChange,
  onOrderToggle,
  onPageChange,
  onPostClick,
}: PostsTabContentProps) {
  return (
    <TabsContent value="posts" className="space-y-6">
      <TopPostsGrid posts={topPosts} loading={topPostsLoading} onPostClick={onPostClick} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-muted-foreground text-sm">Posts performance (server-sorted)</div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={sortBy}
            onValueChange={(value) => onSortByChange(value as AnalyticsPostsSortBy)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="publishedAt">Recent</SelectItem>
              <SelectItem value="engagement">Engagement</SelectItem>
              <SelectItem value="reach">Reach</SelectItem>
              <SelectItem value="engagementRate">Eng. Rate</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={onOrderToggle}>
            {order === 'desc' ? '↓' : '↑'}
          </Button>
        </div>
      </div>
      <PostsPerformanceTable
        posts={posts}
        loading={postsLoading}
        pagination={pagination}
        onPageChange={onPageChange}
        onPostClick={onPostClick}
      />
    </TabsContent>
  );
}
