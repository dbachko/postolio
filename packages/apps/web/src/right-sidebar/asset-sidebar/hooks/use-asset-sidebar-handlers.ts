import { useCallback, type ChangeEvent } from 'react';

import type { SidebarLayout } from '../types';
import type { AssetSidebarModel } from './use-asset-sidebar-model';

type UseAssetSidebarHandlersParams = {
  layout: SidebarLayout;
  onClose?: () => void;
  close: () => void;
  model: AssetSidebarModel;
};

export function useAssetSidebarHandlers({
  layout,
  onClose,
  close,
  model,
}: UseAssetSidebarHandlersParams) {
  const handleClose = useCallback(() => {
    if (layout === 'sidebar') {
      close();
      return;
    }

    onClose?.();
  }, [close, layout, onClose]);

  const handleOpenFullPage = useCallback(() => {
    if (layout === 'sidebar') {
      close();
    }
  }, [close, layout]);

  const handleSave = useCallback(() => {
    if (!model.queries.asset) {
      return;
    }

    model.updateMetadataMutation.mutate({
      title: model.form.formState.title,
      description: model.form.formState.description,
      altText: model.form.formState.altText,
    });
  }, [model]);

  const handleUploadTrigger = useCallback(() => {
    model.preview.uploadInputRef.current?.click();
  }, [model.preview.uploadInputRef]);

  const handleFileSelection = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextFile = event.target.files?.[0];
      if (!nextFile) {
        return;
      }

      model.preview.setPreviewFromFile(nextFile);
      model.replaceFileMutation.mutate(nextFile);
    },
    [model]
  );

  const handleDeleteAsset = useCallback(() => {
    if (!model.queries.asset || model.deleteAssetMutation.isPending) {
      return;
    }

    const confirmed = window.confirm('Delete this asset? This action cannot be undone.');
    if (confirmed) {
      model.deleteAssetMutation.mutate(model.queries.asset.id);
    }
  }, [model]);

  return {
    handleClose,
    handleOpenFullPage,
    handleSave,
    handleUploadTrigger,
    handleFileSelection,
    handleDeleteAsset,
  };
}
