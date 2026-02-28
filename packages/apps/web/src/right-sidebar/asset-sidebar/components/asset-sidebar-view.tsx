import type { ChangeEvent } from 'react';

import type { AssetSidebarModel } from '../hooks/use-asset-sidebar-model';
import type { SidebarLayout } from '../types';
import { AssetSidebarContent } from './asset-sidebar-content';
import { AssetSidebarFooter } from './asset-sidebar-footer';
import { AssetSidebarHeader } from './asset-sidebar-header';

type AssetSidebarViewProps = {
  id?: string;
  layout: SidebarLayout;
  showHeader: boolean;
  bodyClass: string;
  containerClass: string;
  model: AssetSidebarModel;
  assetPreviewUrl: string;
  previewAlt: string;
  onClose: () => void;
  onOpenFullPage: () => void;
  onSave: () => void;
  onFileSelection: (event: ChangeEvent<HTMLInputElement>) => void;
  onUploadTrigger: () => void;
  onDeleteAsset: () => void;
};

export function AssetSidebarView({
  id,
  layout,
  showHeader,
  bodyClass,
  containerClass,
  model,
  assetPreviewUrl,
  previewAlt,
  onClose,
  onOpenFullPage,
  onSave,
  onFileSelection,
  onUploadTrigger,
  onDeleteAsset,
}: AssetSidebarViewProps) {
  const asset = model.queries.asset;

  return (
    <div className={containerClass} role="complementary" aria-labelledby="asset-sidebar-title">
      {showHeader ? (
        <AssetSidebarHeader
          id={id}
          asset={asset}
          layout={layout}
          onClose={onClose}
          onOpenFullPage={onOpenFullPage}
        />
      ) : null}

      <div className={bodyClass}>
        <AssetSidebarContent
          asset={asset}
          assetQueryError={model.queries.assetQuery.error}
          loading={model.queries.assetQuery.isLoading}
          error={model.queries.assetQuery.isError}
          derivedDisplay={model.queries.derivedDisplay}
          formState={model.form.formState}
          setField={model.form.setField}
          collectionOptions={model.queries.collectionOptions}
          selectedCollectionLabel={model.selectedCollectionLabel}
          onCollectionChange={model.form.setCollectionId}
          labels={model.queries.labels}
          labelIds={model.form.labelIds}
          onLabelChange={model.form.setLabelIds}
          onCreateLabel={model.createLabel}
          taxonomyLoading={
            model.queries.collectionsQuery.isLoading || model.queries.labelsQuery.isLoading
          }
          saving={model.updateMetadataMutation.isPending}
          assetPreviewUrl={assetPreviewUrl}
          previewAlt={previewAlt}
          uploadInputRef={model.preview.uploadInputRef}
          onFileSelection={onFileSelection}
          onUploadTrigger={onUploadTrigger}
          onDeleteAsset={onDeleteAsset}
          replacing={model.replaceFileMutation.isPending}
          deleting={model.deleteAssetMutation.isPending}
          detailsOpen={model.form.detailsOpen}
          onToggleDetails={() => model.form.setDetailsOpen((prev) => !prev)}
        />
      </div>

      {asset ? (
        <AssetSidebarFooter
          hasChanges={model.form.hasChanges}
          saving={model.updateMetadataMutation.isPending}
          onReset={model.form.resetFromAsset}
          onSave={onSave}
        />
      ) : null}
    </div>
  );
}
