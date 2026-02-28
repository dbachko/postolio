import type { ChangeEvent, RefObject } from 'react';
import { Loader2 } from 'lucide-react';

import type { AssetType, LabelRecord } from '@/features/assets/api/client';
import type { CollectionMoveOption } from '@/features/assets/components/collection-move-dropdown';

import type { AssetFormState, DerivedAssetDisplay } from '../types';
import { AssetSidebarSections } from './asset-sidebar-sections';

type AssetSidebarContentProps = {
  asset: AssetType | undefined;
  assetQueryError: unknown;
  loading: boolean;
  error: boolean;
  derivedDisplay: DerivedAssetDisplay | null;
  formState: AssetFormState;
  setField: (field: keyof AssetFormState, value: string) => void;
  collectionOptions: CollectionMoveOption[];
  selectedCollectionLabel: string;
  onCollectionChange: (nextCollectionId: string | null) => void;
  labels: LabelRecord[];
  labelIds: string[];
  onLabelChange: (next: string[]) => void;
  onCreateLabel: (name: string) => Promise<LabelRecord>;
  taxonomyLoading: boolean;
  saving: boolean;
  assetPreviewUrl: string;
  previewAlt: string;
  uploadInputRef: RefObject<HTMLInputElement | null>;
  onFileSelection: (event: ChangeEvent<HTMLInputElement>) => void;
  onUploadTrigger: () => void;
  onDeleteAsset: () => void;
  replacing: boolean;
  deleting: boolean;
  detailsOpen: boolean;
  onToggleDetails: () => void;
};

export function AssetSidebarContent({
  asset,
  assetQueryError,
  loading,
  error,
  derivedDisplay,
  formState,
  setField,
  collectionOptions,
  selectedCollectionLabel,
  onCollectionChange,
  labels,
  labelIds,
  onLabelChange,
  onCreateLabel,
  taxonomyLoading,
  saving,
  assetPreviewUrl,
  previewAlt,
  uploadInputRef,
  onFileSelection,
  onUploadTrigger,
  onDeleteAsset,
  replacing,
  deleting,
  detailsOpen,
  onToggleDetails,
}: AssetSidebarContentProps) {
  if (error) {
    return (
      <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-lg border px-4 py-3 text-sm">
        {assetQueryError instanceof Error ? assetQueryError.message : 'Failed to load asset.'}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!asset || !derivedDisplay) {
    return (
      <div className="text-muted-foreground text-sm">Select an asset to view its details.</div>
    );
  }

  return (
    <AssetSidebarLoadedContent
      asset={asset}
      derivedDisplay={derivedDisplay}
      formState={formState}
      setField={setField}
      collectionOptions={collectionOptions}
      selectedCollectionLabel={selectedCollectionLabel}
      onCollectionChange={onCollectionChange}
      labels={labels}
      labelIds={labelIds}
      onLabelChange={onLabelChange}
      onCreateLabel={onCreateLabel}
      taxonomyLoading={taxonomyLoading}
      saving={saving}
      assetPreviewUrl={assetPreviewUrl}
      previewAlt={previewAlt}
      uploadInputRef={uploadInputRef}
      onFileSelection={onFileSelection}
      onUploadTrigger={onUploadTrigger}
      onDeleteAsset={onDeleteAsset}
      replacing={replacing}
      deleting={deleting}
      detailsOpen={detailsOpen}
      onToggleDetails={onToggleDetails}
    />
  );
}

function AssetSidebarLoadedContent({
  asset,
  derivedDisplay,
  formState,
  setField,
  collectionOptions,
  selectedCollectionLabel,
  onCollectionChange,
  labels,
  labelIds,
  onLabelChange,
  onCreateLabel,
  taxonomyLoading,
  saving,
  assetPreviewUrl,
  previewAlt,
  uploadInputRef,
  onFileSelection,
  onUploadTrigger,
  onDeleteAsset,
  replacing,
  deleting,
  detailsOpen,
  onToggleDetails,
}: Omit<AssetSidebarContentProps, 'assetQueryError' | 'loading' | 'error'> & {
  asset: AssetType;
  derivedDisplay: DerivedAssetDisplay;
}) {
  return (
    <AssetSidebarSections
      metadata={{
        formState,
        onTitleChange: (value) => setField('title', value),
        onDescriptionChange: (value) => setField('description', value),
        onAltTextChange: (value) => setField('altText', value),
      }}
      taxonomy={{
        collectionOptions,
        selectedCollectionLabel,
        onCollectionChange,
        labels,
        labelIds,
        onLabelChange,
        onCreateLabel,
        taxonomyLoading,
        saving,
      }}
      preview={{
        asset,
        assetPreviewUrl,
        previewAlt,
        uploadInputRef,
        onFileSelection,
        onUploadTrigger,
        onDeleteAsset,
        replacing,
        deleting,
      }}
      details={{
        asset,
        derivedDisplay,
        detailsOpen,
        onToggleDetails,
      }}
    />
  );
}
