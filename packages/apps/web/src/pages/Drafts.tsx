import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  CalendarDays,
  FileText,
  Image,
  Loader2,
  PencilLine,
  Play,
  Search,
  Video,
} from 'lucide-react';
import { AppEmptyState } from '@/components/app-empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAssetsByIds } from '@/features/assets/hooks/useAssetsByIds';
import type { Asset } from '@/features/assets/api/client';
import { content as contentApi, type Content } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useBrandStore } from '@/stores/brandStore';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';

type DraftTypeFilter = 'all' | 'scheduled' | 'unscheduled';
type DraftSortField = 'lastModified' | 'created';
type SortDirection = 'asc' | 'desc';

type DraftGroup = {
  key: string;
  label: string;
  sortValue: number;
  drafts: Content[];
};

type DraftPreview =
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

const formatMonthLabel = (date: string) =>
  new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date(date));

const formatShortDateTime = (date: string) =>
  new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date));

const groupDraftsByCreatedMonth = (drafts: Content[], direction: SortDirection): DraftGroup[] => {
  const groupsByKey = new Map<string, DraftGroup>();

  drafts.forEach((draft) => {
    const created = new Date(draft.createdAt);
    const monthStart = new Date(created.getFullYear(), created.getMonth(), 1);
    const key = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`;

    const existing = groupsByKey.get(key);
    if (existing) {
      existing.drafts.push(draft);
      return;
    }

    groupsByKey.set(key, {
      key,
      label: formatMonthLabel(draft.createdAt),
      sortValue: monthStart.getTime(),
      drafts: [draft],
    });
  });

  return Array.from(groupsByKey.values()).sort((a, b) =>
    direction === 'asc' ? a.sortValue - b.sortValue : b.sortValue - a.sortValue
  );
};

const getDraftPreview = (primaryAsset: Asset | null): DraftPreview => {
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

function DraftCard({
  draft,
  primaryAsset,
  onOpen,
}: {
  draft: Content;
  primaryAsset: Asset | null;
  onOpen: () => void;
}) {
  const preview = getDraftPreview(primaryAsset);
  const isScheduled = Boolean(draft.scheduledAt);
  const statusVariant = isScheduled ? 'info' : 'secondary';
  const statusLabel = isScheduled ? 'Scheduled' : 'Draft';
  const previewAlt = draft.caption?.trim()
    ? `${draft.caption.trim()} preview`
    : 'Draft media preview';

  let mediaLabel = 'Text';
  let mediaIcon = <FileText className="h-3 w-3" />;
  let previewBody = (
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

  return (
    <Button
      asChild
      variant="ghost"
      className="h-auto w-full flex-col items-stretch justify-start p-0 text-left whitespace-normal hover:bg-transparent"
    >
      <button type="button" onClick={onOpen}>
        <div className="w-full space-y-2">
          <div className="group hover:border-border/80 relative aspect-square w-full overflow-hidden rounded-lg border">
            <div className="absolute top-2 left-2 z-10">
              <Badge variant={statusVariant} className="flex items-center gap-1">
                {isScheduled ? <Calendar className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                <span>{statusLabel}</span>
              </Badge>
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
              {draft.caption?.trim() ? draft.caption.trim() : 'Untitled draft'}
            </div>
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span>
                {isScheduled && draft.scheduledAt
                  ? `Scheduled ${formatShortDateTime(draft.scheduledAt)}`
                  : `Edited ${formatShortDateTime(draft.updatedAt || draft.createdAt)}`}
              </span>
            </div>
          </div>
        </div>
      </button>
    </Button>
  );
}

export default function Drafts() {
  const { selectedBrand } = useBrandStore();
  const [searchInput, setSearchInput] = useState('');
  const [typeFilter, setTypeFilter] = useState<DraftTypeFilter>('all');
  const [sortField, setSortField] = useState<DraftSortField>('lastModified');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const brandId = selectedBrand?.id;

  const { openSidebar } = useRightSidebarRouter();
  const search = useDebounce(searchInput, 350);

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ['drafts', brandId],
    queryFn: async () => {
      if (!brandId) {
        return { content: [] as Content[] };
      }
      const res = await contentApi.getDrafts(brandId);
      return res as { content: Content[] };
    },
    enabled: !!brandId,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });

  const filteredSortedDrafts = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const drafts = (data?.content || [])
      .filter((draft) => {
        const isScheduled = Boolean(draft.scheduledAt);
        if (typeFilter === 'scheduled' && !isScheduled) {
          return false;
        }
        if (typeFilter === 'unscheduled' && isScheduled) {
          return false;
        }
        return true;
      })
      .filter((draft) => {
        if (!normalizedSearch) {
          return true;
        }
        const caption = (draft.caption || '').toLowerCase();
        return caption.includes(normalizedSearch);
      });

    const multiplier = sortDirection === 'asc' ? 1 : -1;
    return [...drafts].sort((a, b) => {
      const aTime =
        sortField === 'created'
          ? new Date(a.createdAt).getTime()
          : new Date(a.updatedAt || a.createdAt).getTime();
      const bTime =
        sortField === 'created'
          ? new Date(b.createdAt).getTime()
          : new Date(b.updatedAt || b.createdAt).getTime();
      if (aTime === bTime) {
        return a.id.localeCompare(b.id) * multiplier;
      }
      return (aTime - bTime) * multiplier;
    });
  }, [data?.content, search, sortDirection, sortField, typeFilter]);

  const groupedDrafts = useMemo(() => {
    const groupDirection = sortField === 'created' ? sortDirection : 'desc';
    return groupDraftsByCreatedMonth(filteredSortedDrafts, groupDirection);
  }, [filteredSortedDrafts, sortDirection, sortField]);

  const resetControls = () => {
    setSearchInput('');
    setTypeFilter('all');
    setSortField('lastModified');
    setSortDirection('desc');
  };

  const assetsQuery = useAssetsByIds(filteredSortedDrafts.map((d) => d.primaryAssetId));
  const assetsById = assetsQuery.data ?? {};

  if (!selectedBrand) {
    return (
      <AppEmptyState
        variant="minimal"
        title="Drafts live inside each brand"
        description="Pick a brand to review drafts, schedule posts, or start something new."
        actions={[{ label: 'Choose Brand', to: '/brands' }]}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search drafts by caption"
              className="pl-9"
            />
          </div>

          <Tabs
            value={typeFilter}
            onValueChange={(value) => setTypeFilter(value as DraftTypeFilter)}
            className="shrink-0"
          >
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
              <TabsTrigger value="unscheduled">Unscheduled</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="flex w-full items-center sm:w-auto">
              <Select value={sortField} onValueChange={(v) => setSortField(v as DraftSortField)}>
                <SelectTrigger className="h-10 w-full rounded-r-none sm:w-auto [&>span]:pr-2 [&>svg]:ml-2">
                  <SelectValue placeholder="Sort drafts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lastModified">Last modified</SelectItem>
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

            <Button onClick={() => openSidebar('post-create')} className="w-full sm:w-auto">
              <PencilLine className="mr-2 h-4 w-4" />
              Create draft
            </Button>
          </div>
        </div>
      </div>

      <div className="relative">
        {isFetching && !isLoading && (
          <div className="bg-background/80 absolute inset-0 z-10 flex items-center justify-center backdrop-blur-sm">
            <div className="bg-background flex items-center gap-2 rounded-lg border px-4 py-3 shadow-lg">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm font-medium">Updating results…</span>
            </div>
          </div>
        )}

        {(() => {
          if (isLoading) {
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

          if (isError) {
            return (
              <div className="rounded-lg border p-6">
                <div className="border-destructive/50 bg-destructive/10 rounded-lg border p-4">
                  <h3 className="text-destructive mb-2 font-semibold">Failed to load drafts</h3>
                  <p className="text-muted-foreground text-sm">
                    Please try again in a moment or refresh the page.
                  </p>
                  <div className="mt-4 flex gap-2">
                    <Button variant="outline" onClick={() => refetch()}>
                      Retry
                    </Button>
                  </div>
                </div>
              </div>
            );
          }

          if (filteredSortedDrafts.length === 0) {
            return (
              <div className="rounded-lg border-2 border-dashed py-12 text-center">
                <p className="text-muted-foreground">No drafts match these filters</p>
                <p className="text-muted-foreground mt-2 text-sm">
                  Try adjusting your search, filters, or create a new draft.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-3">
                  <Button variant="outline" onClick={resetControls}>
                    Reset filters
                  </Button>
                  <Button onClick={() => openSidebar('post-create')}>Create draft</Button>
                </div>
              </div>
            );
          }

          return (
            <div className="space-y-8">
              {groupedDrafts.map((group) => (
                <div key={group.key} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="text-muted-foreground h-4 w-4" />
                    <h3 className="text-sm font-semibold">{group.label}</h3>
                    <span className="text-muted-foreground text-xs">
                      {group.drafts.length} drafts
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {group.drafts.map((draft) => (
                      <DraftCard
                        key={draft.id}
                        draft={draft}
                        primaryAsset={
                          draft.primaryAssetId ? (assetsById[draft.primaryAssetId] ?? null) : null
                        }
                        onOpen={() => openSidebar('post', { id: draft.id })}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
