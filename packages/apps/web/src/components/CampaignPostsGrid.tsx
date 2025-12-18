import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  FileText,
  Image,
  Play,
  Search,
  Video,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAssetsByIds } from '@/features/assets/hooks/useAssetsByIds';
import type { Asset } from '@/features/assets/api/client';
import type { Content } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { useDebounce } from '@/hooks/useDebounce';
import { PostStatusTimeBadge } from '@/components/PostStatusTimeBadge';
import { getPostStatusBorderColor } from '@/utils/post-status-colors';

type PostGroup = {
  key: string;
  label: string;
  sortValue: number;
  posts: Content[];
};

type PostStatusFilter = 'all' | 'draft' | 'scheduled' | 'published';
type PostSortField = 'timeline' | 'created' | 'updated';
type SortDirection = 'asc' | 'desc';

const formatMonthLabel = (date: string) =>
  new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date(date));

const formatShortDateTime = (date: string) =>
  new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date));

const getSortingDate = (post: Content, sortField: PostSortField) => {
  if (sortField === 'created') return post.createdAt;
  if (sortField === 'updated') return post.updatedAt || post.createdAt;
  return post.scheduledAt || post.postedAt || post.createdAt;
};

const groupPostsByMonth = (
  posts: Content[],
  sortField: PostSortField,
  direction: SortDirection
) => {
  const groupsByKey = new Map<string, PostGroup>();

  posts.forEach((post) => {
    const date = new Date(getSortingDate(post, sortField));
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    const key = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`;

    const existing = groupsByKey.get(key);
    if (existing) {
      existing.posts.push(post);
      return;
    }

    groupsByKey.set(key, {
      key,
      label: formatMonthLabel(getSortingDate(post, sortField)),
      sortValue: monthStart.getTime(),
      posts: [post],
    });
  });

  return Array.from(groupsByKey.values()).sort((a, b) =>
    direction === 'asc' ? a.sortValue - b.sortValue : b.sortValue - a.sortValue
  );
};

type PostPreview =
  | {
      kind: 'video';
      url: string;
      posterUrl: string | null;
    }
  | {
      kind: 'image';
      url: string;
    }
  | {
      kind: 'text';
      url: null;
    };

const getPostPreview = (primaryAsset: Asset | null): PostPreview => {
  if (!primaryAsset) {
    return { kind: 'text', url: null };
  }

  if (primaryAsset.fileType === 'video') {
    return {
      kind: 'video',
      url: primaryAsset.url,
      posterUrl: primaryAsset.thumbnailUrl ?? null,
    };
  }

  const url = primaryAsset.thumbnailUrl || primaryAsset.url;
  return { kind: 'image', url };
};

function PostCard({
  post,
  primaryAsset,
  onOpen,
}: {
  post: Content;
  primaryAsset: Asset | null;
  onOpen: () => void;
}) {
  const preview = getPostPreview(primaryAsset);
  const borderColor = getPostStatusBorderColor(post.status);
  const previewAlt = post.caption?.trim() ? `${post.caption.trim()} preview` : 'Post media preview';

  let mediaLabel = 'Text';
  let mediaIcon: ReactNode = <FileText className="h-3 w-3" />;
  let previewBody: ReactNode = (
    <div className="bg-muted flex h-full w-full items-center justify-center">
      <FileText className="text-muted-foreground h-8 w-8" />
    </div>
  );

  if (preview.kind === 'video') {
    mediaLabel = 'Video';
    mediaIcon = <Video className="h-3 w-3" />;
    previewBody = (
      <div className="relative h-full w-full">
        <video
          src={preview.url}
          poster={preview.posterUrl || undefined}
          className="h-full w-full object-cover"
          muted
          playsInline
          preload="metadata"
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-full bg-black/60 p-2">
            <Play className="h-4 w-4 text-white" />
          </div>
        </div>
      </div>
    );
  } else if (preview.kind === 'image') {
    mediaLabel = 'Image';
    mediaIcon = <Image className="h-3 w-3" />;
    previewBody = (
      <img
        src={preview.url}
        alt={previewAlt}
        className="h-full w-full object-cover"
        loading="lazy"
      />
    );
  }

  const statusTimestamp =
    (post.status === 'published' && post.postedAt) ||
    (post.status === 'scheduled' && post.scheduledAt) ||
    post.scheduledAt ||
    post.postedAt ||
    null;
  const statusTimeLabel = statusTimestamp ? formatShortDateTime(statusTimestamp) : null;
  const statusLabel = `${post.status.slice(0, 1).toUpperCase()}${post.status.slice(1)}`;
  const lastEditedLabel = `Last edited ${formatShortDateTime(post.updatedAt || post.createdAt)}`;

  return (
    <button type="button" onClick={onOpen} className="w-full text-left">
      <div className="space-y-2">
        <div
          className="group relative aspect-square overflow-hidden rounded-lg border"
          style={{ borderColor }}
        >
          <div className="absolute top-2 left-2 z-10">
            <PostStatusTimeBadge
              status={post.status}
              variant="pill"
              title={statusTimeLabel ? `${statusLabel} • ${statusTimeLabel}` : statusLabel}
              aria-label={statusTimeLabel ? `${statusLabel} • ${statusTimeLabel}` : statusLabel}
            >
              {statusTimeLabel ?? statusLabel}
            </PostStatusTimeBadge>
          </div>

          <div className="absolute top-2 right-2 z-10">
            <Badge variant="secondary" className="flex items-center gap-1">
              {mediaIcon}
              <span>{mediaLabel}</span>
            </Badge>
          </div>

          {previewBody}
        </div>

        <div className="space-y-1">
          <div className="line-clamp-2 text-sm font-semibold">
            {post.caption?.trim() ? post.caption.trim() : 'Untitled post'}
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span>{lastEditedLabel}</span>
            {post.campaignName && (
              <span className="inline-flex items-center gap-1">
                <span
                  className={cn('h-2 w-2 rounded-full border', !post.campaignColor && 'bg-muted')}
                  style={post.campaignColor ? { backgroundColor: post.campaignColor } : undefined}
                />
                <span className="max-w-[200px] truncate">{post.campaignName}</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

export function CampaignPostsGrid({
  title = 'Posts',
  posts,
  isLoading,
  isGenerating,
  action,
}: {
  title?: string;
  posts: Content[];
  isLoading?: boolean;
  isGenerating?: boolean;
  action?: ReactNode;
}) {
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
      <CardContent>
        {(() => {
          if (isGenerating || isLoading) {
            return (
              <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {Array.from({ length: 10 }).map((_, idx) => (
                  <div key={idx} className="space-y-2">
                    <Skeleton className="aspect-square rounded-lg" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                ))}
              </div>
            );
          }

          if ((posts || []).length === 0) {
            return (
              <div className="rounded-lg border-2 border-dashed py-12 text-center">
                <p className="text-muted-foreground">No posts yet for this campaign</p>
                <p className="text-muted-foreground mt-2 text-sm">
                  Fill the window to generate posts, then open any post to review and schedule.
                </p>
              </div>
            );
          }

          if (filteredSortedPosts.length === 0) {
            return (
              <div className="rounded-lg border-2 border-dashed py-12 text-center">
                <p className="text-muted-foreground">No posts match these filters</p>
                <p className="text-muted-foreground mt-2 text-sm">
                  Try adjusting your search and filters.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-3">
                  <Button variant="outline" onClick={resetControls}>
                    Reset filters
                  </Button>
                </div>
              </div>
            );
          }

          return (
            <div className="space-y-8">
              {grouped.map((group) => (
                <div key={group.key} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="text-muted-foreground h-4 w-4" />
                    <h3 className="text-sm font-semibold">{group.label}</h3>
                    <span className="text-muted-foreground text-xs">
                      {group.posts.length} posts
                    </span>
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
        })()}
      </CardContent>
    </Card>
  );
}
