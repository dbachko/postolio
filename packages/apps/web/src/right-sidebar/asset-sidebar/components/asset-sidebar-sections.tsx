import type { ChangeEvent, RefObject } from 'react';

import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import {
  CollectionMoveDropdown,
  type CollectionMoveOption,
} from '@/features/assets/components/collection-move-dropdown';
import type { AssetType, LabelRecord } from '@/features/assets/api/client';

import type { AssetFormState, DerivedAssetDisplay } from '../types';
import { AssetDetailsSection } from './asset-details-section';
import { AssetLabelInput } from './asset-label-input';
import { AssetMetadataForm } from './asset-metadata-form';
import { AssetPreviewSection } from './asset-preview-section';

type MetadataSectionProps = {
  formState: AssetFormState;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onAltTextChange: (value: string) => void;
};

type TaxonomySectionProps = {
  collectionOptions: CollectionMoveOption[];
  selectedCollectionLabel: string;
  onCollectionChange: (nextCollectionId: string | null) => void;
  labels: LabelRecord[];
  labelIds: string[];
  onLabelChange: (next: string[]) => void;
  onCreateLabel: (name: string) => Promise<LabelRecord>;
  taxonomyLoading: boolean;
  saving: boolean;
};

type PreviewSectionProps = {
  asset: AssetType;
  assetPreviewUrl: string;
  previewAlt: string;
  uploadInputRef: RefObject<HTMLInputElement | null>;
  onFileSelection: (event: ChangeEvent<HTMLInputElement>) => void;
  onUploadTrigger: () => void;
  onDeleteAsset: () => void;
  replacing: boolean;
  deleting: boolean;
};

type DetailsSectionProps = {
  asset: AssetType;
  derivedDisplay: DerivedAssetDisplay;
  detailsOpen: boolean;
  onToggleDetails: () => void;
};

type AssetSidebarSectionsProps = {
  metadata: MetadataSectionProps;
  taxonomy: TaxonomySectionProps;
  preview: PreviewSectionProps;
  details: DetailsSectionProps;
};

export function AssetSidebarSections({
  metadata,
  taxonomy,
  preview,
  details,
}: AssetSidebarSectionsProps) {
  return (
    <div className="space-y-8 pb-6">
      <div className="space-y-6">
        <AssetMetadataForm
          title={metadata.formState.title}
          description={metadata.formState.description}
          altText={metadata.formState.altText}
          onTitleChange={(event) => metadata.onTitleChange(event.target.value)}
          onDescriptionChange={(event) => metadata.onDescriptionChange(event.target.value)}
          onAltTextChange={(event) => metadata.onAltTextChange(event.target.value)}
        />

        <Separator />

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Collection</Label>
            <CollectionMoveDropdown
              onMoveToCollection={taxonomy.onCollectionChange}
              collectionOptions={taxonomy.collectionOptions}
              triggerLabel={taxonomy.selectedCollectionLabel}
              side="bottom"
              align="start"
              triggerClassName="h-10 w-full justify-between"
              disabled={taxonomy.saving || taxonomy.taxonomyLoading}
            />
          </div>

          <div className="space-y-2">
            <Label>Labels</Label>
            <AssetLabelInput
              labels={taxonomy.labels}
              value={taxonomy.labelIds}
              onChange={taxonomy.onLabelChange}
              onCreateLabel={taxonomy.onCreateLabel}
              disabled={taxonomy.taxonomyLoading || taxonomy.saving}
            />
          </div>
        </div>

        <Separator />

        <AssetPreviewSection
          asset={preview.asset}
          assetPreviewUrl={preview.assetPreviewUrl}
          previewAlt={preview.previewAlt}
          uploadInputRef={preview.uploadInputRef}
          onFileSelection={preview.onFileSelection}
          onUploadTrigger={preview.onUploadTrigger}
          onDeleteAsset={preview.onDeleteAsset}
          isReplacing={preview.replacing}
          isDeleting={preview.deleting}
        />

        <Separator />

        <AssetDetailsSection
          asset={details.asset}
          derivedDisplay={details.derivedDisplay}
          detailsOpen={details.detailsOpen}
          onToggleDetails={details.onToggleDetails}
        />
      </div>
    </div>
  );
}
