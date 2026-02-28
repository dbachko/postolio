import { useCallback, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { AssetType } from '@/features/assets/api/client';

import {
  useCreateAssetLabel,
  useDeleteAssetMutation,
  useReplaceAssetFileMutation,
  useUpdateAssetMetadataMutation,
} from './use-asset-sidebar-mutations';
import { useAssetSidebarQueries } from './use-asset-sidebar-queries';
import { useAssetSidebarFormState, useAssetSidebarPreviewState } from './use-asset-sidebar-state';

export function useAssetSidebarModel(id?: string, onDeleteSuccess?: () => void) {
  const queryClient = useQueryClient();
  const queries = useAssetSidebarQueries(id);
  const form = useAssetSidebarFormState(queries.asset);
  const preview = useAssetSidebarPreviewState();
  const { clearPreview, resetInput } = preview;

  useEffect(() => {
    clearPreview();
  }, [clearPreview, queries.asset?.id]);

  const onAssetUpdated = useCallback(
    (updated: AssetType) => {
      queryClient.setQueryData(['asset', updated.id], updated);
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      form.applyAsset(updated);
      clearPreview();
    },
    [clearPreview, form, queryClient]
  );

  const updateMetadataMutation = useUpdateAssetMetadataMutation({
    id,
    collectionId: form.collectionId,
    labelIds: form.labelIds,
    onAssetUpdated,
  });

  const replaceFileMutation = useReplaceAssetFileMutation({
    asset: queries.asset,
    onAssetUpdated,
    onSettled: resetInput,
  });

  const deleteAssetMutation = useDeleteAssetMutation({
    onDeleted: (deletedId) => {
      queryClient.removeQueries({ queryKey: ['asset', deletedId], exact: true });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      onDeleteSuccess?.();
    },
  });

  const createLabel = useCreateAssetLabel({
    brandId: queries.brandId,
    queryClient,
  });

  const selectedCollectionLabel = useMemo(() => {
    if (!form.collectionId) {
      return 'Unsorted';
    }

    return queries.collectionNameById.get(form.collectionId) ?? 'Unsorted';
  }, [form.collectionId, queries.collectionNameById]);

  return {
    queries,
    form,
    preview,
    updateMetadataMutation,
    replaceFileMutation,
    deleteAssetMutation,
    createLabel,
    selectedCollectionLabel,
  };
}

export type AssetSidebarModel = ReturnType<typeof useAssetSidebarModel>;
