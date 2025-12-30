import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, CalendarDays, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAssetsByIds } from '@/features/assets/hooks/useAssetsByIds';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { useDebounce } from '@/hooks/useDebounce';
import type {
  CampaignPostsGridProps,
  PostSortField,
  PostStatusFilter,
  SortDirection,
} from './types';
import { groupPostsByMonth, getSortingDate } from './utils';
import { EmptyState } from './components/empty-state';
import { LoadingGrid } from './components/loading-grid';
import { PostCard } from './components/post-card';

export function CampaignPostsGrid({
  title = 'Posts',
  posts,
  isLoading,
  isGenerating,
  action,
}: CampaignPostsGridProps) {
  const { openSidebar } = useRightSidebarRouter();

  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState<PostStatusFilter>('all');
  const [sortField, setSortField] = useState<PostSortField>('timeline');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const search = useDebounce(searchInput, 350);

  const filteredSortedPosts = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    const filtered = (posts || [])
      .filter((post) => {
        if (statusFilter === 'all') return true;
        return post.status === statusFilter;
      })
      .filter((post) => {
        if (!normalizedSearch) return true;
        const caption = (post.caption || '').toLowerCase();
        return caption.includes(normalizedSearch);
      });

    const multiplier = sortDirection === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const aTime = new Date(getSortingDate(a, sortField)).getTime();
      const bTime = new Date(getSortingDate(b, sortField)).getTime();
      if (aTime === bTime) return a.id.localeCompare(b.id) * multiplier;
      return (aTime - bTime) * multiplier;
    });
  }, [posts, search, sortDirection, sortField, statusFilter]);

  const grouped = useMemo(
    () => groupPostsByMonth(filteredSortedPosts, sortField, sortDirection),
    [filteredSortedPosts, sortDirection, sortField]
  );

  const assetsQuery = useAssetsByIds(filteredSortedPosts.map((post) => post.primaryAssetId));
  const assetsById = assetsQuery.data ?? {};

  const resetControls = () => {
    setSearchInput('');
    setStatusFilter('all');
    setSortField('timeline');
    setSortDirection('desc');
  };

  let body: ReactNode;
  if (isGenerating || isLoading) {
    body = <LoadingGrid />;
  } else if ((posts || []).length === 0) {
    body = (
      <EmptyState
        title="No posts yet for this campaign"
        description="Fill the window to generate posts, then open any post to review and schedule."
      />
    );
  } else if (filteredSortedPosts.length === 0) {
    body = (
      <EmptyState
        title="No posts match these filters"
        description="Try adjusting your search and filters."
        action={
          <Button variant="outline" onClick={resetControls}>
            Reset filters
          </Button>
        }
      />
    );
  } else {
    body = (
      <div className="space-y-8">
        {grouped.map((group) => (
          <div key={group.key} className="space-y-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="text-muted-foreground h-4 w-4" />
              <h3 className="text-sm font-semibold">{group.label}</h3>
              <span className="text-muted-foreground text-xs">{group.posts.length} posts</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {group.posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  primaryAsset={
                    post.primaryAssetId ? (assetsById[post.primaryAssetId] ?? null) : null
                  }
                  onOpen={() => openSidebar('post', { id: post.id })}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-3">
            <CardTitle className="mr-auto">{title}</CardTitle>
            <div className="relative min-w-[240px] flex-1">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search posts by caption"
                className="pl-9"
              />
            </div>

            <Tabs
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as PostStatusFilter)}
              className="shrink-0"
            >
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="published">Published</TabsTrigger>
                <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
                <TabsTrigger value="draft">Drafts</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-start">
              <div className="flex w-full items-center sm:w-auto">
                <Select value={sortField} onValueChange={(v) => setSortField(v as PostSortField)}>
                  <SelectTrigger className="h-10 w-full rounded-r-none sm:w-[220px]">
                    <SelectValue placeholder="Sort posts" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="timeline">Schedule / publish date</SelectItem>
                    <SelectItem value="updated">Last modified</SelectItem>
                    <SelectItem value="created">Created date</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  className="h-10 rounded-l-none border-l-0"
                  onClick={() => setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                  aria-label={`Sort ${sortDirection === 'asc' ? 'ascending' : 'descending'}`}
                >
                  {sortDirection === 'asc' ? (
                    <ArrowUp className="h-4 w-4" />
                  ) : (
                    <ArrowDown className="h-4 w-4" />
                  )}
                </Button>
              </div>

              {action}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
