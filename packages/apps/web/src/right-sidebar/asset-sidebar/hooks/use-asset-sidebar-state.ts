import { useCallback, useEffect, useRef, useState } from 'react';

import type { AssetType } from '@/features/assets/api/client';

import type { AssetFormState } from '../types';
import { DEFAULT_FORM_STATE } from '../constants';

function toFormState(asset: AssetType): AssetFormState {
  return {
    title: asset.title || '',
    description: asset.description || '',
    altText: asset.altText || '',
  };
}

function hasChanged(
  asset: AssetType,
  formState: AssetFormState,
  collectionId: string | null,
  labelIds: string[]
) {
  const metaChanged =
    formState.title !== (asset.title || '') ||
    formState.description !== (asset.description || '') ||
    formState.altText !== (asset.altText || '');
  const collectionChanged = (collectionId ?? null) !== (asset.collectionId ?? null);

  const originalLabels = [...(asset.labelIds ?? [])].sort();
  const currentLabels = [...labelIds].sort();
  const labelsChanged =
    originalLabels.length !== currentLabels.length ||
    originalLabels.some((value, index) => value !== currentLabels[index]);

  return metaChanged || collectionChanged || labelsChanged;
}

export function useAssetSidebarFormState(asset: AssetType | undefined) {
  const [formState, setFormState] = useState<AssetFormState>(DEFAULT_FORM_STATE);
  const [hasChanges, setHasChanges] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [labelIds, setLabelIds] = useState<string[]>([]);

  useEffect(() => {
    if (!asset) {
      return;
    }

    setFormState(toFormState(asset));
    setCollectionId(asset.collectionId ?? null);
    setLabelIds(asset.labelIds ?? []);
    setHasChanges(false);
  }, [asset]);

  useEffect(() => {
    if (!asset) {
      return;
    }

    setHasChanges(hasChanged(asset, formState, collectionId, labelIds));
  }, [asset, collectionId, formState, labelIds]);

  const setField = useCallback(
    (field: keyof AssetFormState, value: string) => {
      setFormState((prev) => ({ ...prev, [field]: value }));
      if (asset) {
        setHasChanges(true);
      }
    },
    [asset]
  );

  const resetFromAsset = useCallback(() => {
    if (!asset) {
      return;
    }

    setFormState(toFormState(asset));
    setCollectionId(asset.collectionId ?? null);
    setLabelIds(asset.labelIds ?? []);
    setHasChanges(false);
  }, [asset]);

  const applyAsset = useCallback((nextAsset: AssetType) => {
    setFormState(toFormState(nextAsset));
    setCollectionId(nextAsset.collectionId ?? null);
    setLabelIds(nextAsset.labelIds ?? []);
    setHasChanges(false);
  }, []);

  return {
    formState,
    setField,
    hasChanges,
    detailsOpen,
    setDetailsOpen,
    collectionId,
    setCollectionId,
    labelIds,
    setLabelIds,
    resetFromAsset,
    applyAsset,
  };
}

export function useAssetSidebarPreviewState() {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    },
    [previewUrl]
  );

  const clearPreview = useCallback(() => {
    setPreviewUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });
  }, []);

  const setPreviewFromFile = useCallback((file: File) => {
    setPreviewUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return URL.createObjectURL(file);
    });
  }, []);

  const resetInput = useCallback(() => {
    if (uploadInputRef.current) {
      uploadInputRef.current.value = '';
    }
  }, []);

  return {
    uploadInputRef,
    previewUrl,
    clearPreview,
    setPreviewFromFile,
    resetInput,
  };
}
