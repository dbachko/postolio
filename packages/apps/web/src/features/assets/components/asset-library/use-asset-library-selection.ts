import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { assetsApi, type AssetType, type AssetUsageEntry } from '@/features/assets/api/client';

type OpenSidebarFn = (
  panel: 'post-create',
  options: { params: { assetId: string | null; assetIds: string | null } }
) => void;

type AssetUsageResponse = { usage: AssetUsageEntry[] };

type UseAssetSelectionStateParams = {
  sortedAssets: AssetType[];
};

type UseAssetUsageStateParams = {
  brandId?: string;
  sortedSelectionIds: string[];
  selectedAssets: AssetType[];
};

type UseMoveSelectedAssetsParams = {
  brandId?: string;
  selectedAssetIds: string[];
};

type UseDeleteSelectedAssetsParams = {
  brandId?: string;
  selectedAssets: AssetType[];
  deleteBlockedReason: string | null;
  setSelected: Dispatch<SetStateAction<Map<string, AssetType>>>;
};

type UseCreatePostFromSelectionParams = {
  selectedAssets: AssetType[];
  openSidebar: OpenSidebarFn;
  clearSelection: () => void;
};

type AssetSelectionState = {
  selected: Map<string, AssetType>;
  selectedAssets: AssetType[];
  selectedAssetIds: string[];
  sortedSelectionIds: string[];
  clearSelection: () => void;
  toggleSelect: (asset: AssetType, opts?: { shiftKey?: boolean }) => void;
  setSelected: Dispatch<SetStateAction<Map<string, AssetType>>>;
};

type AssetUsageState = {
  isCheckingUsage: boolean;
  deleteBlockedReason: string | null;
  deleteTooltip: string | undefined;
};

type MoveSelectedAssetsState = {
  isMovingSelected: boolean;
  moveSelectedToCollection: (collectionId: string | null) => Promise<void>;
};

type DeleteSelectedAssetsState = {
  showDeleteDialog: boolean;
  setShowDeleteDialog: (open: boolean) => void;
  deleteSelectedPending: boolean;
  openDeleteSelectedDialog: () => void;
  confirmDeleteSelected: () => void;
};

export type AssetLibrarySelectionState = {
  selected: Map<string, AssetType>;
  selectedAssets: AssetType[];
  clearSelection: () => void;
  toggleSelect: (asset: AssetType, opts?: { shiftKey?: boolean }) => void;
  isMovingSelected: boolean;
  moveSelectedToCollection: (collectionId: string | null) => Promise<void>;
  createPostFromSelection: () => void;
  showDeleteDialog: boolean;
  setShowDeleteDialog: (open: boolean) => void;
  deleteSelectedPending: boolean;
  openDeleteSelectedDialog: () => void;
  confirmDeleteSelected: () => void;
  deleteBlockedReason: string | null;
  deleteTooltip: string | undefined;
  isCheckingUsage: boolean;
};

function useAssetSelectionState({
  sortedAssets,
}: UseAssetSelectionStateParams): AssetSelectionState {
  const [selected, setSelected] = useState<Map<string, AssetType>>(new Map());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const selectedAssets = useMemo(() => Array.from(selected.values()), [selected]);
  const selectedAssetIds = useMemo(() => selectedAssets.map((asset) => asset.id), [selectedAssets]);
  const sortedSelectionIds = useMemo(
    () => Array.from(new Set(selectedAssetIds)).sort(),
    [selectedAssetIds]
  );

  const clearSelection = useCallback(() => {
    setSelected(new Map());
    setLastSelectedId(null);
  }, []);

  const toggleSelect = useCallback(
    (asset: AssetType, opts?: { shiftKey?: boolean }) => {
      if (opts?.shiftKey && lastSelectedId && sortedAssets.length > 0) {
        const start = sortedAssets.findIndex((entry) => entry.id === lastSelectedId);
        const end = sortedAssets.findIndex((entry) => entry.id === asset.id);
        if (start !== -1 && end !== -1) {
          const [from, to] = start < end ? [start, end] : [end, start];
          setSelected((previous) => {
            const next = new Map(previous);
            for (let index = from; index <= to; index += 1) {
              const current = sortedAssets[index];
              if (current) {
                next.set(current.id, current);
              }
            }
            return next;
          });
          setLastSelectedId(asset.id);
          return;
        }
      }

      setSelected((previous) => {
        const next = new Map(previous);
        if (next.has(asset.id)) {
          next.delete(asset.id);
        } else {
          next.set(asset.id, asset);
        }
        return next;
      });
      setLastSelectedId(asset.id);
    },
    [lastSelectedId, sortedAssets]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selected.size > 0) {
        clearSelection();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearSelection, selected.size]);

  return {
    selected,
    selectedAssets,
    selectedAssetIds,
    sortedSelectionIds,
    clearSelection,
    toggleSelect,
    setSelected,
  };
}

function useAssetUsageState({
  brandId,
  sortedSelectionIds,
  selectedAssets,
}: UseAssetUsageStateParams): AssetUsageState {
  const usageQuery = useQuery<AssetUsageResponse, Error>({
    queryKey: ['asset-usage', brandId ?? '', sortedSelectionIds.join(',')],
    queryFn: () => assetsApi.getUsage(sortedSelectionIds, brandId as string),
    enabled: Boolean(brandId) && sortedSelectionIds.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  useEffect(() => {
    if (usageQuery.isError) {
      toast.error('Unable to check if these assets are used in posts right now.');
    }
  }, [usageQuery.isError]);

  const usedAssetIds = useMemo(() => {
    const usage = usageQuery.data?.usage ?? [];
    const usedIds = usage.filter((entry) => entry.usedInPosts).map((entry) => entry.assetId);
    return new Set(usedIds);
  }, [usageQuery.data]);

  const deleteBlockedReason = useMemo(() => {
    if (selectedAssets.length === 0) {
      return null;
    }
    if (usageQuery.isError) {
      return 'Unable to verify whether these assets are used in posts. Please try again before deleting.';
    }
    if (usedAssetIds.size === 0) {
      return null;
    }
    if (selectedAssets.length === 1 && usedAssetIds.has(selectedAssets[0].id)) {
      return 'This asset is used in one or more posts. Remove it from those posts before deleting it.';
    }
    return 'Some assets are used in posts. Deselect those assets before deleting.';
  }, [selectedAssets, usageQuery.isError, usedAssetIds]);

  const deleteTooltip =
    deleteBlockedReason ||
    (usageQuery.isFetching && selectedAssets.length > 0
      ? 'Checking whether selected assets are used in posts…'
      : undefined);

  return {
    isCheckingUsage: usageQuery.isFetching,
    deleteBlockedReason,
    deleteTooltip,
  };
}

function useMoveSelectedAssets({
  brandId,
  selectedAssetIds,
}: UseMoveSelectedAssetsParams): MoveSelectedAssetsState {
  const queryClient = useQueryClient();
  const [isMovingSelected, setIsMovingSelected] = useState(false);

  const moveSelectedToCollection = useCallback(
    async (targetCollectionId: string | null) => {
      if (!brandId || selectedAssetIds.length === 0 || isMovingSelected) {
        return;
      }

      setIsMovingSelected(true);
      try {
        await assetsApi.bulkAssets({
          brandId,
          assetIds: selectedAssetIds,
          action: { move_to_collection: { collectionId: targetCollectionId } },
        });
        await queryClient.invalidateQueries({ queryKey: ['assets'] });
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

  return { isMovingSelected, moveSelectedToCollection };
}

function useDeleteSelectedAssets({
  brandId,
  selectedAssets,
  deleteBlockedReason,
  setSelected,
}: UseDeleteSelectedAssetsParams): DeleteSelectedAssetsState {
  const queryClient = useQueryClient();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const deleteSelectedMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!brandId) {
        throw new Error('Missing brand');
      }
      await assetsApi.bulkAssets({ brandId, assetIds: ids, action: { delete: {} } });
    },
    onSuccess: async (_data, ids) => {
      setSelected((previous) => {
        const next = new Map(previous);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ['assets'] });
      setShowDeleteDialog(false);
      toast.success(ids.length === 1 ? 'Asset deleted' : `${ids.length} assets deleted`);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to delete assets';
      toast.error(message);
    },
  });

  const openDeleteSelectedDialog = useCallback(() => {
    if (selectedAssets.length === 0) {
      return;
    }
    if (deleteBlockedReason) {
      toast.info(deleteBlockedReason);
      return;
    }
    setShowDeleteDialog(true);
  }, [deleteBlockedReason, selectedAssets.length]);

  const confirmDeleteSelected = useCallback(() => {
    if (deleteBlockedReason) {
      toast.info(deleteBlockedReason);
      setShowDeleteDialog(false);
      return;
    }
    deleteSelectedMutation.mutate(selectedAssets.map((asset) => asset.id));
  }, [deleteBlockedReason, deleteSelectedMutation, selectedAssets]);

  useEffect(() => {
    if (showDeleteDialog && deleteBlockedReason) {
      setShowDeleteDialog(false);
    }
  }, [deleteBlockedReason, showDeleteDialog]);

  return {
    showDeleteDialog,
    setShowDeleteDialog,
    deleteSelectedPending: deleteSelectedMutation.isPending,
    openDeleteSelectedDialog,
    confirmDeleteSelected,
  };
}

function useCreatePostFromSelection({
  selectedAssets,
  openSidebar,
  clearSelection,
}: UseCreatePostFromSelectionParams) {
  return useCallback(() => {
    if (selectedAssets.length === 0) {
      return;
    }

    const images = selectedAssets.filter((asset) => asset.fileType === 'image');
    const videos = selectedAssets.filter((asset) => asset.fileType === 'video');
    const maxImages = 10;

    if (videos.length > 0 && images.length === 0) {
      if (videos.length > 1) {
        toast.info('Only one video can be attached; using the first video selected.');
      }
      openSidebar('post-create', { params: { assetId: videos[0].id, assetIds: null } });
      clearSelection();
      return;
    }

    if (images.length === 0) {
      return;
    }

    const limitedImages = images.slice(0, maxImages);
    if (images.length > maxImages) {
      toast.info(`Only the first ${maxImages} images were attached. Select fewer to include all.`);
    }
    if (videos.length > 0) {
      toast.info('Videos cannot be combined with images; only images were attached.');
    }
    const imageIds = limitedImages.map((asset) => asset.id);
    openSidebar('post-create', { params: { assetIds: imageIds.join(','), assetId: null } });
    clearSelection();
  }, [clearSelection, openSidebar, selectedAssets]);
}

export function useAssetLibrarySelectionState({
  brandId,
  sortedAssets,
  openSidebar,
}: {
  brandId?: string;
  sortedAssets: AssetType[];
  openSidebar: OpenSidebarFn;
}): AssetLibrarySelectionState {
  const selection = useAssetSelectionState({ sortedAssets });
  const usage = useAssetUsageState({
    brandId,
    sortedSelectionIds: selection.sortedSelectionIds,
    selectedAssets: selection.selectedAssets,
  });
  const moveSelected = useMoveSelectedAssets({
    brandId,
    selectedAssetIds: selection.selectedAssetIds,
  });
  const deleteSelected = useDeleteSelectedAssets({
    brandId,
    selectedAssets: selection.selectedAssets,
    deleteBlockedReason: usage.deleteBlockedReason,
    setSelected: selection.setSelected,
  });
  const createPostFromSelection = useCreatePostFromSelection({
    selectedAssets: selection.selectedAssets,
    openSidebar,
    clearSelection: selection.clearSelection,
  });

  return {
    selected: selection.selected,
    selectedAssets: selection.selectedAssets,
    clearSelection: selection.clearSelection,
    toggleSelect: selection.toggleSelect,
    isMovingSelected: moveSelected.isMovingSelected,
    moveSelectedToCollection: moveSelected.moveSelectedToCollection,
    createPostFromSelection,
    showDeleteDialog: deleteSelected.showDeleteDialog,
    setShowDeleteDialog: deleteSelected.setShowDeleteDialog,
    deleteSelectedPending: deleteSelected.deleteSelectedPending,
    openDeleteSelectedDialog: deleteSelected.openDeleteSelectedDialog,
    confirmDeleteSelected: deleteSelected.confirmDeleteSelected,
    deleteBlockedReason: usage.deleteBlockedReason,
    deleteTooltip: usage.deleteTooltip,
    isCheckingUsage: usage.isCheckingUsage,
  };
}
