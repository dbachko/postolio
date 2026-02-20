import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  FolderIcon,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  assetsApi,
  type AssetType,
  type AssetUsageEntry,
  type CollectionNode,
  type LabelRecord,
} from '@/features/assets/api/client';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { AppEmptyState } from '@/components/app-empty-state';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AssetCard } from './AssetCard';
import { SortControls } from './SortControls';
import { SelectionBar, type SelectionCollectionOption } from './SelectionBar';
import { DeleteAssetsDialog } from './DeleteAssetsDialog';
import { FilterPanel, type AssetFilters } from './FilterPanel';
import { groupByMonth, sortAssets, useDebouncedValue } from './asset-utils';
import type { AssetTypeFilter, SortDirection, SortField } from './asset-utils';
import { cn } from '@/lib/utils';
import { getLocalSetting, setLocalSetting } from '@/lib/settings/localSettings';

export interface AssetLibraryProps {
  brandId?: string;
}

const COLLECTION_EXPANDED_STORAGE_KEY_PREFIX = 'asset-library:expanded-collections';
const ROOT_COLLECTION_INLINE_PARENT_ID = '__root_collection__';
const UNSORTED_COLLECTION_PARAM = 'unsorted';

function getCollectionExpansionStorageKey(brandId?: string): string | undefined {
  return brandId ? `${COLLECTION_EXPANDED_STORAGE_KEY_PREFIX}:${brandId}` : undefined;
}

function collectCollectionIds(nodes: CollectionNode[]): Set<string> {
  const ids = new Set<string>();

  const walk = (items: CollectionNode[]) => {
    for (const item of items) {
      ids.add(item.id);
      if (item.children?.length) {
        walk(item.children);
      }
    }
  };

  walk(nodes);
  return ids;
}

export default function AssetLibrary({ brandId }: AssetLibraryProps) {
  const [searchInput, setSearchInput] = useState('');
  const [typeFilter, setTypeFilter] = useState<AssetTypeFilter>('all');
  const [sortField, setSortField] = useState<SortField>('created');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set());
  const [inlineRenameId, setInlineRenameId] = useState<string | null>(null);
  const [inlineRenameValue, setInlineRenameValue] = useState('');
  const [inlineCreateParentId, setInlineCreateParentId] = useState<string | null>(null);
  const [inlineCreateValue, setInlineCreateValue] = useState('');
  const [isInlineRenameSaving, setIsInlineRenameSaving] = useState(false);
  const [isInlineCreateSaving, setIsInlineCreateSaving] = useState(false);
  const [selected, setSelected] = useState<Map<string, AssetType>>(new Map());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [isMovingSelected, setIsMovingSelected] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [filters, setFilters] = useState<AssetFilters>({
    aspectRatios: [],
    orientationTypes: [],
    usageStatuses: [],
    recentOnly: false,
  });
  const search = useDebouncedValue(searchInput, 350);
  const { openSidebar } = useRightSidebarRouter();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const collectionsQuery = useQuery({
    queryKey: ['asset-collections', brandId ?? '', 'tree'],
    queryFn: () =>
      assetsApi.listTaxonomy({
        brandId: brandId as string,
        type: 'COLLECTION',
        format: 'tree',
      }),
    enabled: !!brandId,
    staleTime: 30_000,
  });

  const labelsQuery = useQuery({
    queryKey: ['asset-labels', brandId ?? ''],
    queryFn: () =>
      assetsApi.listTaxonomy({
        brandId: brandId as string,
        type: 'LABEL',
        includeArchived: false,
      }),
    enabled: !!brandId,
    staleTime: 30_000,
  });

  const { data, isLoading, isFetching, isFetchingNextPage, hasNextPage, fetchNextPage } =
    useInfiniteQuery({
      queryKey: ['assets', brandId, search, typeFilter, filters, collectionId, labelIds],
      queryFn: ({ pageParam = 1 }) => {
        const usageFilter =
          filters.usageStatuses.length === 1 ? filters.usageStatuses[0] : undefined;
        const recentAfter = filters.recentOnly
          ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
          : undefined;

        return assetsApi.listAssets({
          brandId,
          page: pageParam,
          limit: 30,
          search,
          type: typeFilter === 'all' ? undefined : typeFilter,
          collectionId: collectionId || undefined,
          includeSubcollections:
            collectionId && collectionId !== UNSORTED_COLLECTION_PARAM ? true : undefined,
          labelIds: labelIds.length > 0 ? labelIds : undefined,
          labelMode: 'any',
          aspectRatios: filters.aspectRatios.length > 0 ? filters.aspectRatios : undefined,
          orientationTypes:
            filters.orientationTypes.length > 0 ? filters.orientationTypes : undefined,
          minWidth: filters.minWidth,
          maxWidth: filters.maxWidth,
          minHeight: filters.minHeight,
          maxHeight: filters.maxHeight,
          uploadedAfter: recentAfter || filters.uploadedAfter,
          uploadedBefore: filters.uploadedBefore,
          usage: usageFilter,
        });
      },
      enabled: !!brandId,
      getNextPageParam: (lastPage) =>
        lastPage.pagination.page < lastPage.pagination.totalPages
          ? lastPage.pagination.page + 1
          : undefined,
      initialPageParam: 1,
      staleTime: 5_000,
      refetchOnWindowFocus: false,
    });

  const collections = (collectionsQuery.data?.collections ?? []) as CollectionNode[];
  const labels = (labelsQuery.data?.labels ?? []) as LabelRecord[];
  const unsortedAssetCount = collectionsQuery.data?.unsortedAssetCount;

  const allAssets = useMemo(() => data?.pages.flatMap((page) => page.assets) ?? [], [data?.pages]);
  const sortedAssets = useMemo(
    () => sortAssets(allAssets, sortField, sortDirection),
    [allAssets, sortField, sortDirection]
  );
  const groupedAssets = useMemo(() => groupByMonth(sortedAssets), [sortedAssets]);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const collectionExpansionStorageKey = useMemo(
    () => getCollectionExpansionStorageKey(brandId),
    [brandId]
  );

  const labelOptions = useMemo(
    () =>
      labels.map((label) => ({
        label: label.name,
        value: label.id,
      })),
    [labels]
  );

  const findCollectionById = useCallback(
    (nodes: CollectionNode[], id: string | null): CollectionNode | null => {
      if (!id) return null;
      for (const node of nodes) {
        if (node.id === id) return node;
        if (node.children?.length) {
          const found = findCollectionById(node.children, id);
          if (found) return found;
        }
      }
      return null;
    },
    []
  );

  const isUnsortedCollectionSelected = collectionId === UNSORTED_COLLECTION_PARAM;
  const selectedCollection = useMemo(
    () => (isUnsortedCollectionSelected ? null : findCollectionById(collections, collectionId)),
    [collections, collectionId, findCollectionById, isUnsortedCollectionSelected]
  );

  const selectionCollectionOptions = useMemo<SelectionCollectionOption[]>(() => {
    const options: SelectionCollectionOption[] = [];

    const walk = (nodes: CollectionNode[], depth: number) => {
      for (const node of nodes) {
        options.push({ id: node.id, name: node.name, depth });
        if (node.children?.length) {
          walk(node.children, depth + 1);
        }
      }
    };

    walk(collections, 0);
    return options;
  }, [collections]);

  const setCollectionSelection = useCallback(
    (nextCollectionId: string | null, options?: { replace?: boolean }) => {
      setCollectionId(nextCollectionId);
      const next = new URLSearchParams(searchParams);
      if (nextCollectionId) {
        next.set('collection', nextCollectionId);
      } else {
        next.delete('collection');
      }
      setSearchParams(next, { replace: options?.replace ?? false });
    },
    [searchParams, setSearchParams]
  );

  const setCollectionExpanded = useCallback((id: string, open: boolean) => {
    setExpandedCollections((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!collectionExpansionStorageKey) {
      setExpandedCollections(new Set());
      return;
    }

    const stored = getLocalSetting<unknown>(collectionExpansionStorageKey);
    if (Array.isArray(stored)) {
      const ids = stored.filter((value): value is string => typeof value === 'string');
      setExpandedCollections(new Set(ids));
      return;
    }

    setExpandedCollections(new Set());
  }, [collectionExpansionStorageKey]);

  useEffect(() => {
    if (!collectionExpansionStorageKey) return;
    setLocalSetting(collectionExpansionStorageKey, Array.from(expandedCollections));
  }, [collectionExpansionStorageKey, expandedCollections]);

  useEffect(() => {
    if (!collectionsQuery.isFetched) return;
    const validIds = collectCollectionIds(collections);
    setExpandedCollections((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (validIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [collections, collectionsQuery.isFetched]);

  const startInlineCreateRootCollection = useCallback(() => {
    setInlineRenameId(null);
    setInlineRenameValue('');
    setInlineCreateParentId(ROOT_COLLECTION_INLINE_PARENT_ID);
    setInlineCreateValue('');
  }, []);

  const startInlineRenameCollection = useCallback((collection: CollectionNode) => {
    setInlineCreateParentId(null);
    setInlineCreateValue('');
    setInlineRenameId(collection.id);
    setInlineRenameValue(collection.name);
  }, []);

  const cancelInlineRenameCollection = useCallback(() => {
    setInlineRenameId(null);
    setInlineRenameValue('');
  }, []);

  const submitInlineRenameCollection = useCallback(async () => {
    if (!brandId || !inlineRenameId) return;
    const nextName = inlineRenameValue.trim();
    if (!nextName) {
      toast.error('Collection name is required');
      return;
    }

    setIsInlineRenameSaving(true);
    try {
      await assetsApi.updateTaxonomy(inlineRenameId, {
        brandId,
        name: nextName,
      });
      setInlineRenameId(null);
      setInlineRenameValue('');
      await queryClient.invalidateQueries({ queryKey: ['asset-collections', brandId] });
      toast.success('Collection renamed');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rename collection';
      toast.error(message);
    } finally {
      setIsInlineRenameSaving(false);
    }
  }, [brandId, inlineRenameId, inlineRenameValue, queryClient]);

  const startInlineCreateSubcollection = useCallback(
    (collection: CollectionNode) => {
      setInlineRenameId(null);
      setInlineRenameValue('');
      setInlineCreateParentId(collection.id);
      setInlineCreateValue('');
      setCollectionSelection(collection.id);
      setCollectionExpanded(collection.id, true);
    },
    [setCollectionExpanded, setCollectionSelection]
  );

  const cancelInlineCreateCollection = useCallback(() => {
    setInlineCreateParentId(null);
    setInlineCreateValue('');
  }, []);

  const submitInlineCreateCollection = useCallback(async () => {
    if (!brandId || !inlineCreateParentId) return;
    const nextName = inlineCreateValue.trim();
    if (!nextName) {
      toast.error('Collection name is required');
      return;
    }

    const isRootCollection = inlineCreateParentId === ROOT_COLLECTION_INLINE_PARENT_ID;
    const parentId = isRootCollection ? null : inlineCreateParentId;

    setIsInlineCreateSaving(true);
    try {
      const response = await assetsApi.createTaxonomy({
        brandId,
        type: 'COLLECTION',
        name: nextName,
        parentId,
      });
      setInlineCreateParentId(null);
      setInlineCreateValue('');
      if (parentId) {
        setCollectionExpanded(parentId, true);
      }
      setCollectionSelection(response.item.id);
      await queryClient.invalidateQueries({ queryKey: ['asset-collections', brandId] });
      toast.success(isRootCollection ? 'Collection created' : 'Sub-collection created');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create collection';
      toast.error(message);
    } finally {
      setIsInlineCreateSaving(false);
    }
  }, [
    brandId,
    inlineCreateParentId,
    inlineCreateValue,
    queryClient,
    setCollectionExpanded,
    setCollectionSelection,
  ]);

  const handleDeleteCollection = useCallback(
    async (collection: CollectionNode) => {
      if (!brandId) return;
      const confirmed = window.confirm(
        'Delete this collection? Assets inside will be moved to Unsorted.'
      );
      if (!confirmed) return;
      try {
        await assetsApi.deleteTaxonomy(collection.id, {
          brandId,
          onNotEmpty: 'move_to_unsorted',
        });
        if (collectionId === collection.id) {
          setCollectionSelection(null, { replace: true });
        }
        if (inlineRenameId === collection.id) {
          setInlineRenameId(null);
          setInlineRenameValue('');
        }
        if (inlineCreateParentId === collection.id) {
          setInlineCreateParentId(null);
          setInlineCreateValue('');
        }
        await queryClient.invalidateQueries({ queryKey: ['asset-collections', brandId] });
        await queryClient.invalidateQueries({ queryKey: ['assets'] });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to delete collection';
        toast.error(message);
      }
    },
    [
      brandId,
      collectionId,
      inlineCreateParentId,
      inlineRenameId,
      queryClient,
      setCollectionSelection,
      setInlineCreateParentId,
      setInlineCreateValue,
      setInlineRenameId,
      setInlineRenameValue,
    ]
  );

  const handleCollectionPrimaryAction = useCallback(
    (collection: CollectionNode, hasChildren: boolean, isExpanded: boolean) => {
      setCollectionSelection(collection.id);
      if (hasChildren && !isExpanded) {
        setCollectionExpanded(collection.id, true);
      }
    },
    [setCollectionExpanded, setCollectionSelection]
  );

  const handleCollectionChevronClick = useCallback(
    (collection: CollectionNode, hasChildren: boolean, isExpanded: boolean) => {
      if (!hasChildren) {
        setCollectionSelection(collection.id);
        return;
      }
      setCollectionExpanded(collection.id, !isExpanded);
    },
    [setCollectionExpanded, setCollectionSelection]
  );

  const selectedAssets = useMemo(() => Array.from(selected.values()), [selected]);
  const selectedAssetIds = useMemo(() => selectedAssets.map((asset) => asset.id), [selectedAssets]);
  const sortedSelectionIds = useMemo(
    () => Array.from(new Set(selectedAssetIds)).sort(),
    [selectedAssetIds]
  );

  const handleMoveSelectedToCollection = useCallback(
    async (targetCollectionId: string | null) => {
      if (!brandId || selectedAssetIds.length === 0 || isMovingSelected) return;
      setIsMovingSelected(true);
      try {
        await assetsApi.bulkAssets({
          brandId,
          assetIds: selectedAssetIds,
          action: { move_to_collection: { collectionId: targetCollectionId } },
        });
        queryClient.invalidateQueries({ queryKey: ['assets'] });
        toast.success('Assets moved');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to move assets';
        toast.error(message);
      } finally {
        setIsMovingSelected(false);
      }
    },
    [brandId, isMovingSelected, queryClient, selectedAssetIds]
  );

  const clearSelection = useCallback(() => {
    setSelected(new Map());
    setLastSelectedId(null);
  }, []);

  const toggleSelect = useCallback(
    (asset: AssetType, opts?: { shiftKey?: boolean }) => {
      if (opts?.shiftKey && lastSelectedId && sortedAssets.length > 0) {
        const start = sortedAssets.findIndex((a) => a.id === lastSelectedId);
        const end = sortedAssets.findIndex((a) => a.id === asset.id);
        if (start !== -1 && end !== -1) {
          const [from, to] = start < end ? [start, end] : [end, start];
          setSelected((prev) => {
            const next = new Map(prev);
            for (let i = from; i <= to; i += 1) {
              const current = sortedAssets[i];
              if (current) next.set(current.id, current);
            }
            return next;
          });
          setLastSelectedId(asset.id);
          return;
        }
      }

      setSelected((prev) => {
        const next = new Map(prev);
        if (next.has(asset.id)) next.delete(asset.id);
        else next.set(asset.id, asset);
        return next;
      });
      setLastSelectedId(asset.id);
    },
    [lastSelectedId, sortedAssets]
  );

  type AssetUsageResponse = { usage: AssetUsageEntry[] };

  const {
    data: usageData,
    isFetching: isCheckingUsage,
    isError: isUsageError,
  } = useQuery<AssetUsageResponse, Error>({
    queryKey: ['asset-usage', brandId ?? '', sortedSelectionIds.join(',')],
    queryFn: () => assetsApi.getUsage(sortedSelectionIds, brandId as string),
    enabled: !!brandId && sortedSelectionIds.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  useEffect(() => {
    if (isUsageError) {
      toast.error('Unable to check if these assets are used in posts right now.');
    }
  }, [isUsageError]);

  const usedAssetIds = useMemo(() => {
    const usage = usageData?.usage ?? [];
    const usedIds = usage.filter((entry) => entry.usedInPosts).map((entry) => entry.assetId);
    return new Set(usedIds);
  }, [usageData]);

  let deleteBlockedReason: string | null = null;
  if (selectedAssets.length > 0) {
    if (isUsageError) {
      deleteBlockedReason =
        'Unable to verify whether these assets are used in posts. Please try again before deleting.';
    } else if (usedAssetIds.size > 0) {
      if (selectedAssets.length === 1 && usedAssetIds.has(selectedAssets[0].id)) {
        deleteBlockedReason =
          'This asset is used in one or more posts. Remove it from those posts before deleting it.';
      } else {
        deleteBlockedReason =
          'Some assets are used in posts. Deselect those assets before deleting.';
      }
    }
  }

  const deleteTooltip =
    deleteBlockedReason ||
    (isCheckingUsage && selectedAssets.length > 0
      ? 'Checking whether selected assets are used in posts…'
      : undefined);

  const deleteSelected = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!brandId) throw new Error('Missing brand');
      await assetsApi.bulkAssets({
        brandId,
        assetIds: ids,
        action: { delete: {} },
      });
    },
    onSuccess: (_data, ids) => {
      setSelected((prev) => {
        const next = new Map(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      setShowDeleteDialog(false);
      toast.success(ids.length === 1 ? 'Asset deleted' : `${ids.length} assets deleted`);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to delete assets';
      toast.error(message);
    },
  });

  const handleDeleteSelected = () => {
    if (selectedAssets.length === 0) return;
    if (deleteBlockedReason) {
      toast.info(deleteBlockedReason);
      return;
    }
    setShowDeleteDialog(true);
  };

  const handleCreatePostFromSelection = () => {
    if (selectedAssets.length === 0) return;
    const images = selectedAssets.filter((a) => a.fileType === 'image');
    const videos = selectedAssets.filter((a) => a.fileType === 'video');
    const maxImages = 10;

    if (videos.length > 0 && images.length === 0) {
      if (videos.length > 1) {
        toast.info('Only one video can be attached; using the first video selected.');
      }
      openSidebar('post-create', { params: { assetId: videos[0].id, assetIds: null } });
      clearSelection();
      return;
    }

    if (images.length > 0) {
      const limitedImages = images.slice(0, maxImages);
      if (images.length > maxImages) {
        toast.info(
          `Only the first ${maxImages} images were attached. Select fewer to include all.`
        );
      }
      const imageIds = limitedImages.map((a) => a.id);
      if (videos.length > 0) {
        toast.info('Videos cannot be combined with images; only images were attached.');
      }
      openSidebar('post-create', { params: { assetIds: imageIds.join(','), assetId: null } });
      clearSelection();
      return;
    }
  };

  const handleOpenAsset = useCallback(
    (assetId: string) => {
      openSidebar('asset', { id: assetId });
    },
    [openSidebar]
  );

  const resetFilters = useCallback(() => {
    setSearchInput('');
    setTypeFilter('all');
    setSortField('created');
    setSortDirection('desc');
    setCollectionSelection(null);
    setLabelIds([]);
    setFilters({
      aspectRatios: [],
      orientationTypes: [],
      usageStatuses: [],
      recentOnly: false,
    });
    clearSelection();
  }, [clearSelection, setCollectionSelection]);

  const handleResetFilters = useCallback(() => {
    setLabelIds([]);
    setFilters({
      aspectRatios: [],
      orientationTypes: [],
      usageStatuses: [],
      recentOnly: false,
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selected.size > 0) {
        clearSelection();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearSelection, selected.size]);

  useEffect(() => {
    if (showDeleteDialog && deleteBlockedReason) {
      setShowDeleteDialog(false);
    }
  }, [deleteBlockedReason, showDeleteDialog]);

  useEffect(() => {
    const fromUrl = searchParams.get('collection');
    const nextId = fromUrl && fromUrl.trim().length > 0 ? fromUrl : null;
    setCollectionId((prev) => (prev === nextId ? prev : nextId));
  }, [searchParams]);

  useEffect(() => {
    if (!collectionId || !collectionsQuery.isFetched) return;
    if (collectionId === UNSORTED_COLLECTION_PARAM) return;
    if (findCollectionById(collections, collectionId)) return;
    setCollectionId(null);
    const next = new URLSearchParams(searchParams);
    next.delete('collection');
    setSearchParams(next, { replace: true });
  }, [
    collectionId,
    collections,
    collectionsQuery.isFetched,
    findCollectionById,
    searchParams,
    setSearchParams,
  ]);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || !hasNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: '320px 0px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, sortedAssets.length]);

  const renderCollectionNode = useCallback(
    (node: CollectionNode) => {
      const hasChildren = node.children && node.children.length > 0;
      const isExpanded = expandedCollections.has(node.id);
      const isSelected = collectionId === node.id;
      const isInlineRenaming = inlineRenameId === node.id;
      const isInlineCreatingSub = inlineCreateParentId === node.id;
      const showExpandedCount = hasChildren && isExpanded && typeof node.assetCount === 'number';

      const rowClass = cn(
        'group/menu-item flex h-7 w-full min-w-0 items-center justify-start gap-2 rounded-md px-2 text-sm transition-colors',
        isSelected
          ? 'bg-accent text-accent-foreground'
          : 'text-foreground/80 hover:bg-accent/50 hover:text-foreground'
      );
      const branchClass = 'ml-4 mt-1 flex min-w-0 flex-col gap-1 border-l border-border/70 pl-3';

      return (
        <Collapsible
          key={node.id}
          open={hasChildren ? isExpanded : false}
          onOpenChange={(open) => {
            if (hasChildren) setCollectionExpanded(node.id, open);
          }}
        >
          <div className={rowClass}>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground inline-flex h-4 w-4 flex-shrink-0 items-center justify-center"
              aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
              onClick={(event) => {
                event.stopPropagation();
                handleCollectionChevronClick(node, hasChildren, isExpanded);
              }}
            >
              {hasChildren ? (
                isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )
              ) : (
                <ChevronRight className="h-3.5 w-3.5 opacity-40" />
              )}
            </button>
            {isInlineRenaming ? (
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <FolderIcon className="text-muted-foreground h-4 w-4 shrink-0" />
                <Input
                  value={inlineRenameValue}
                  onChange={(event) => setInlineRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void submitInlineRenameCollection();
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      cancelInlineRenameCollection();
                    }
                  }}
                  autoFocus
                  className="h-7"
                  placeholder="Collection name"
                />
              </div>
            ) : (
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
                onClick={() => handleCollectionPrimaryAction(node, hasChildren, isExpanded)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <FolderIcon className="text-muted-foreground h-4 w-4 shrink-0" />
                  <span className="truncate text-sm font-medium">{node.name}</span>
                </span>
                {showExpandedCount ? (
                  <span className="text-muted-foreground shrink-0 text-xs font-medium">
                    {node.assetCount} {node.assetCount === 1 ? 'asset' : 'assets'}
                  </span>
                ) : null}
              </button>
            )}
            {isInlineRenaming ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => {
                    void submitInlineRenameCollection();
                  }}
                  disabled={isInlineRenameSaving}
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={cancelInlineRenameCollection}
                  disabled={isInlineRenameSaving}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'text-muted-foreground hover:text-foreground hover:bg-background/70 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity',
                      'group-hover/menu-item:opacity-100 focus:opacity-100'
                    )}
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`Actions for ${node.name}`}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  side="bottom"
                  onClick={(event) => event.stopPropagation()}
                >
                  <DropdownMenuItem onClick={() => startInlineCreateSubcollection(node)}>
                    New sub-collection
                  </DropdownMenuItem>
                  {selectedAssets.length > 0 ? (
                    <DropdownMenuItem onClick={() => handleMoveSelectedToCollection(node.id)}>
                      Move selected here
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => startInlineRenameCollection(node)}>
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => handleDeleteCollection(node)}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {!hasChildren && (isInlineCreatingSub || (isSelected && !isInlineRenaming)) ? (
            <div className={branchClass}>
              {isInlineCreatingSub ? (
                <div className="flex h-7 w-full items-center gap-2 rounded-md px-2">
                  <Plus className="text-muted-foreground h-4 w-4 shrink-0" />
                  <Input
                    value={inlineCreateValue}
                    onChange={(event) => setInlineCreateValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void submitInlineCreateCollection();
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        cancelInlineCreateCollection();
                      }
                    }}
                    autoFocus
                    className="h-7"
                    placeholder="New sub-collection name"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => {
                      void submitInlineCreateCollection();
                    }}
                    disabled={isInlineCreateSaving}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={cancelInlineCreateCollection}
                    disabled={isInlineCreateSaving}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  className="text-muted-foreground hover:bg-accent/50 hover:text-foreground flex h-7 w-full items-center gap-2 rounded-md px-2 text-sm transition-colors"
                  onClick={() => startInlineCreateSubcollection(node)}
                >
                  <Plus className="h-4 w-4" />
                  <span className="truncate font-medium">Create sub-collection</span>
                </button>
              )}
            </div>
          ) : null}

          {hasChildren ? (
            <CollapsibleContent className={branchClass}>
              {isInlineCreatingSub ? (
                <div className="flex h-7 w-full items-center gap-2 rounded-md px-2">
                  <Plus className="text-muted-foreground h-4 w-4 shrink-0" />
                  <Input
                    value={inlineCreateValue}
                    onChange={(event) => setInlineCreateValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void submitInlineCreateCollection();
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        cancelInlineCreateCollection();
                      }
                    }}
                    autoFocus
                    className="h-7"
                    placeholder="New sub-collection name"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => {
                      void submitInlineCreateCollection();
                    }}
                    disabled={isInlineCreateSaving}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={cancelInlineCreateCollection}
                    disabled={isInlineCreateSaving}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
              {node.children.map((child) => renderCollectionNode(child))}
            </CollapsibleContent>
          ) : null}
        </Collapsible>
      );
    },
    [
      collectionId,
      expandedCollections,
      inlineCreateParentId,
      inlineCreateValue,
      inlineRenameId,
      inlineRenameValue,
      isInlineCreateSaving,
      isInlineRenameSaving,
      cancelInlineCreateCollection,
      cancelInlineRenameCollection,
      handleCollectionChevronClick,
      handleCollectionPrimaryAction,
      handleDeleteCollection,
      handleMoveSelectedToCollection,
      setInlineCreateValue,
      setInlineRenameValue,
      startInlineCreateSubcollection,
      startInlineRenameCollection,
      selectedAssets.length,
      setCollectionExpanded,
      submitInlineCreateCollection,
      submitInlineRenameCollection,
    ]
  );
  const isInlineCreatingRootCollection = inlineCreateParentId === ROOT_COLLECTION_INLINE_PARENT_ID;

  if (!brandId) {
    return (
      <AppEmptyState
        variant="minimal"
        title="Select a brand to browse assets"
        description="Asset searches, uploads, and collections are scoped to an individual brand."
        actions={[{ label: 'Choose Brand', to: '/brands' }]}
        className="min-h-[360px]"
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,_1fr)]">
        <aside className="space-y-6 lg:sticky lg:top-4 lg:self-start">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Collections</Label>
              <TooltipProvider delayDuration={0} skipDelayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={startInlineCreateRootCollection}
                      aria-label="New collection"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">New collection</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="space-y-0.5">
              <button
                type="button"
                className={cn(
                  'group/menu-item flex h-7 w-full min-w-0 items-center justify-start gap-2 rounded-md px-2 text-sm transition-colors',
                  isUnsortedCollectionSelected
                    ? 'bg-accent text-accent-foreground'
                    : 'text-foreground/80 hover:bg-accent/50 hover:text-foreground'
                )}
                onClick={() => setCollectionSelection(UNSORTED_COLLECTION_PARAM)}
              >
                <span className="h-4 w-4 shrink-0" />
                <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <FolderIcon className="text-muted-foreground h-4 w-4 shrink-0" />
                    <span className="truncate text-sm font-medium">Unsorted</span>
                  </span>
                  {typeof unsortedAssetCount === 'number' ? (
                    <span className="text-muted-foreground shrink-0 text-xs font-medium">
                      {unsortedAssetCount} {unsortedAssetCount === 1 ? 'asset' : 'assets'}
                    </span>
                  ) : null}
                </span>
              </button>

              {isInlineCreatingRootCollection ? (
                <div className="group/menu-item text-foreground/80 flex h-7 w-full min-w-0 items-center justify-start gap-2 rounded-md px-2 text-sm">
                  <span className="h-4 w-4 shrink-0" />
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <FolderIcon className="text-muted-foreground h-4 w-4 shrink-0" />
                    <Input
                      value={inlineCreateValue}
                      onChange={(event) => setInlineCreateValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void submitInlineCreateCollection();
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          cancelInlineCreateCollection();
                        }
                      }}
                      autoFocus
                      className="h-7"
                      placeholder="Collection name"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => {
                        void submitInlineCreateCollection();
                      }}
                      disabled={isInlineCreateSaving}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={cancelInlineCreateCollection}
                      disabled={isInlineCreateSaving}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : null}

              {collections.map((node) => renderCollectionNode(node))}

              {collections.length === 0 && !isInlineCreatingRootCollection ? (
                <p className="text-muted-foreground text-xs">No collections yet.</p>
              ) : null}
            </div>
          </div>
        </aside>

        <div className="min-w-0 space-y-6">
          <div className="bg-card border-border rounded-lg border p-4 shadow-sm">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0 space-y-2">
                  <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    Media Library
                  </p>
                  <div className="text-muted-foreground text-xs">
                    {isUnsortedCollectionSelected ? (
                      <span>
                        In collection <span className="text-foreground">Unsorted</span>
                      </span>
                    ) : selectedCollection ? (
                      <span>
                        In collection{' '}
                        <span className="text-foreground">{selectedCollection.name}</span>
                      </span>
                    ) : (
                      <span>All collections</span>
                    )}
                    {labelIds.length > 0 ? (
                      <span>
                        {' • '}
                        {labelIds.length} label{labelIds.length === 1 ? '' : 's'} selected
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2 self-start">
                  <Button onClick={() => openSidebar('asset-upload', { id: brandId })}>
                    <Upload className="mr-2 h-4 w-4" />
                    Upload
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 xl:grid-cols-[minmax(0,_1fr)_auto_auto_auto] xl:items-center">
                <div className="relative min-w-0">
                  <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                  <Input
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Search assets by title or filename"
                    className="pl-9"
                  />
                </div>
                <Tabs
                  value={typeFilter}
                  onValueChange={(value) => setTypeFilter(value as AssetTypeFilter)}
                  className="shrink-0"
                >
                  <TabsList>
                    <TabsTrigger value="all">All</TabsTrigger>
                    <TabsTrigger value="image">Images</TabsTrigger>
                    <TabsTrigger value="video">Videos</TabsTrigger>
                  </TabsList>
                </Tabs>
                <FilterPanel
                  filters={filters}
                  labelIds={labelIds}
                  labelOptions={labelOptions}
                  onLabelIdsChange={setLabelIds}
                  onChange={setFilters}
                  onReset={handleResetFilters}
                />
                <SortControls
                  field={sortField}
                  direction={sortDirection}
                  onFieldChange={(field) => setSortField(field)}
                  onDirectionToggle={() =>
                    setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
                  }
                  triggerWidthClassName="sm:w-auto"
                />
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
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {Array.from({ length: 10 }).map((_, idx) => (
                      <div key={idx} className="space-y-2">
                        <Skeleton className="aspect-square rounded-lg" />
                        <Skeleton className="h-3 w-2/3" />
                      </div>
                    ))}
                  </div>
                );
              }

              if (sortedAssets.length === 0) {
                return (
                  <div className="rounded-lg border-2 border-dashed py-12 text-center">
                    <p className="text-muted-foreground">No assets match these filters</p>
                    <p className="text-muted-foreground mt-2 text-sm">
                      Try adjusting search or upload your first image or video.
                    </p>
                    <div className="mt-4 flex justify-center gap-3">
                      <Button variant="outline" onClick={resetFilters}>
                        Reset filters
                      </Button>
                      <Button onClick={() => openSidebar('asset-upload', { id: brandId })}>
                        Upload assets
                      </Button>
                    </div>
                  </div>
                );
              }

              return (
                <div className="space-y-8">
                  {Object.entries(groupedAssets).map(([month, assets]) => (
                    <div key={month} className="space-y-3">
                      <div className="flex items-center gap-2">
                        <CalendarDays className="text-muted-foreground h-4 w-4" />
                        <h3 className="text-sm font-semibold">{month}</h3>
                        <span className="text-muted-foreground text-xs">
                          {assets.length} assets
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                        {assets.map((asset) => (
                          <AssetCard
                            key={asset.id}
                            asset={asset}
                            selected={selected.has(asset.id)}
                            onToggle={(opts) => toggleSelect(asset, opts)}
                            onOpen={() => handleOpenAsset(asset.id)}
                            onCreatePost={() =>
                              openSidebar('post-create', {
                                params: { assetId: asset.id, assetIds: null },
                              })
                            }
                          />
                        ))}
                      </div>
                    </div>
                  ))}

                  <div ref={loadMoreRef} className="h-1" />
                  {isFetchingNextPage && (
                    <div className="text-muted-foreground flex justify-center py-4 text-sm">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading more assets…
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      <SelectionBar
        count={selectedAssets.length}
        onClear={clearSelection}
        onMoveToCollection={handleMoveSelectedToCollection}
        collectionOptions={selectionCollectionOptions}
        movePending={isMovingSelected}
        onCreatePost={handleCreatePostFromSelection}
        onDelete={handleDeleteSelected}
        deletePending={deleteSelected.isPending}
        deleteDisabled={!!deleteBlockedReason || isCheckingUsage}
        deleteTooltip={deleteTooltip}
      />

      <DeleteAssetsDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        count={selectedAssets.length}
        isPending={deleteSelected.isPending}
        onConfirm={() => {
          if (deleteBlockedReason) {
            toast.info(deleteBlockedReason);
            setShowDeleteDialog(false);
            return;
          }
          deleteSelected.mutate(selectedAssets.map((asset) => asset.id));
        }}
      />
    </div>
  );
}
