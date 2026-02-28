import { useMemo } from 'react';

import { cn } from '@/lib/utils';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';

import { AssetSidebarView } from './components/asset-sidebar-view';
import { useAssetSidebarHandlers } from './hooks/use-asset-sidebar-handlers';
import { useAssetSidebarModel } from './hooks/use-asset-sidebar-model';
import type { AssetSidebarProps } from './types';

export function AssetSidebar({
  id,
  layout = 'sidebar',
  onClose,
  showHeader = true,
}: AssetSidebarProps) {
  const { close } = useRightSidebarRouter();
  const closeSidebar = () => {
    if (layout === 'sidebar') {
      close();
      return;
    }

    onClose?.();
  };
  const model = useAssetSidebarModel(id, closeSidebar);
  const {
    handleClose,
    handleOpenFullPage,
    handleSave,
    handleUploadTrigger,
    handleFileSelection,
    handleDeleteAsset,
  } = useAssetSidebarHandlers({
    layout,
    onClose,
    close,
    model,
  });

  const bodyClass =
    layout === 'sidebar' ? 'flex-1 overflow-y-auto px-4 py-4' : 'flex-1 overflow-y-auto px-6 py-6';
  const containerClass = useMemo(
    () => cn('flex flex-col', layout === 'sidebar' ? 'h-full shadow-lg' : 'min-h-[60vh] w-full'),
    [layout]
  );

  const asset = model.queries.asset;
  const assetPreviewUrl = model.preview.previewUrl || asset?.url || asset?.thumbnailUrl || '';
  const previewAlt = model.form.formState.altText || asset?.altText || asset?.fileName || 'Asset';

  return (
    <AssetSidebarView
      id={id}
      layout={layout}
      showHeader={showHeader}
      bodyClass={bodyClass}
      containerClass={containerClass}
      model={model}
      assetPreviewUrl={assetPreviewUrl}
      previewAlt={previewAlt}
      onClose={handleClose}
      onOpenFullPage={handleOpenFullPage}
      onSave={handleSave}
      onFileSelection={handleFileSelection}
      onUploadTrigger={handleUploadTrigger}
      onDeleteAsset={handleDeleteAsset}
    />
  );
}

export default AssetSidebar;
