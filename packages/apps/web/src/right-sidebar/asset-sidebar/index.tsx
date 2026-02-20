import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import {
  assetsApi,
  type AssetType,
  type CollectionNode,
  type LabelRecord,
} from '@/features/assets/api/client';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import {
  CollectionMoveDropdown,
  type CollectionMoveOption,
} from '@/features/assets/components/collection-move-dropdown';

import type { AssetFormState, AssetSidebarProps, DerivedAssetDisplay } from './types';
import {
  DEFAULT_FORM_STATE,
  IMAGE_UPLOAD_LIMIT_BYTES,
  VIDEO_UPLOAD_LIMIT_BYTES,
} from './constants';
import {
  formatBytes,
  formatDateTime,
  getFileExtension,
  probeImageDimensions,
  probeVideoMetadata,
} from './utils';
import { AssetDetailsSection } from './components/asset-details-section';
import { AssetMetadataForm } from './components/asset-metadata-form';
import { AssetPreviewSection } from './components/asset-preview-section';
import { AssetSidebarFooter } from './components/asset-sidebar-footer';
import { AssetSidebarHeader } from './components/asset-sidebar-header';
import { AssetLabelInput } from './components/asset-label-input';

export function AssetSidebar({
  id,
  layout = 'sidebar',
  onClose,
  showHeader = true,
}: AssetSidebarProps) {
  const { close } = useRightSidebarRouter();
  const queryClient = useQueryClient();

  const [formState, setFormState] = useState<AssetFormState>(DEFAULT_FORM_STATE);
  const [hasChanges, setHasChanges] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [labelIds, setLabelIds] = useState<string[]>([]);

  const assetQuery = useQuery({
    queryKey: ['asset', id],
    queryFn: async (): Promise<AssetType> => {
      const response = await assetsApi.getAsset(id!);
      return response.asset;
    },
    enabled: Boolean(id),
    staleTime: 5_000,
  });

  const asset = assetQuery.data;
  const brandId = asset?.brandId;

  const collectionsQuery = useQuery({
    queryKey: ['asset-collections', brandId ?? '', 'tree'],
    queryFn: () =>
      assetsApi.listTaxonomy({
        brandId: brandId as string,
        type: 'COLLECTION',
        format: 'tree',
      }),
    enabled: Boolean(brandId),
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
    enabled: Boolean(brandId),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!asset) return;
    setFormState({
      title: asset.title || '',
      description: asset.description || '',
      altText: asset.altText || '',
    });
    setCollectionId(asset.collectionId ?? null);
    setLabelIds(asset.labelIds ?? []);
    setHasChanges(false);
    setPreviewUrl(null);
  }, [asset]);

  useEffect(
    () => () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    },
    [previewUrl]
  );

  useEffect(() => {
    if (!asset) return;
    const metaChanged =
      formState.title !== (asset.title || '') ||
      formState.description !== (asset.description || '') ||
      formState.altText !== (asset.altText || '');
    const currentCollection = asset.collectionId ?? null;
    const collectionChanged = (collectionId ?? null) !== currentCollection;
    const assetLabels = asset.labelIds ?? [];
    const sortedA = [...assetLabels].sort();
    const sortedB = [...labelIds].sort();
    const labelsChanged =
      sortedA.length !== sortedB.length || sortedA.some((val, idx) => val !== sortedB[idx]);

    setHasChanges(metaChanged || collectionChanged || labelsChanged);
  }, [asset, formState, collectionId, labelIds]);

  const mutationSuccess = (updated: AssetType) => {
    queryClient.setQueryData(['asset', updated.id], updated);
    queryClient.invalidateQueries({ queryKey: ['assets'] });
    setFormState({
      title: updated.title || '',
      description: updated.description || '',
      altText: updated.altText || '',
    });
    setCollectionId(updated.collectionId ?? null);
    setLabelIds(updated.labelIds ?? []);
    setHasChanges(false);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  const handleClose = () => {
    if (layout === 'sidebar') {
      close();
    } else if (onClose) {
      onClose();
    }
  };

  const updateMetadataMutation = useMutation({
    mutationFn: async (input: Partial<AssetType>) => {
      if (!id) throw new Error('Missing asset id');
      const { asset: updated } = await assetsApi.updateAsset(id, {
        title: input.title,
        description: input.description,
        altText: input.altText,
        collectionId,
        labelIds,
      });
      return updated;
    },
    onSuccess: (updated) => {
      mutationSuccess(updated);
      toast.success('Asset details updated');
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to update asset';
      toast.error(message);
    },
  });

  const replaceFileMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!asset) throw new Error('Asset not loaded');
      const isImage = file.type.startsWith('image/');
      const fileType = isImage ? 'image' : 'video';
      const limit = isImage ? IMAGE_UPLOAD_LIMIT_BYTES : VIDEO_UPLOAD_LIMIT_BYTES;
      if (file.size > limit) {
        const friendlyLimit = Math.floor(limit / (1024 * 1024));
        throw new Error(
          `Please upload ${fileType === 'image' ? 'images' : 'videos'} smaller than ${friendlyLimit}MB.`
        );
      }

      const uploadInfo = await assetsApi.getUploadUrl({
        brandId: asset.brandId,
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        fileType,
        fileSize: file.size,
      });

      await assetsApi.uploadToS3(file, uploadInfo.uploadUrl);

      const dims = isImage ? await probeImageDimensions(file) : await probeVideoMetadata(file);

      const { asset: updated } = await assetsApi.updateAsset(asset.id, {
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileType,
        fileSize: file.size,
        s3Key: uploadInfo.s3Key,
        width: dims.width,
        height: dims.height,
        duration: dims.duration,
      });

      return updated;
    },
    onSuccess: (updated) => {
      mutationSuccess(updated);
      toast.success('Asset file replaced');
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to replace asset file';
      toast.error(message);
    },
    onSettled: () => {
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    },
  });

  const deleteAssetMutation = useMutation({
    mutationFn: async (assetId: string) => {
      await assetsApi.deleteAsset(assetId);
      return assetId;
    },
    onSuccess: (deletedId) => {
      queryClient.removeQueries({ queryKey: ['asset', deletedId], exact: true });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      toast.success('Asset deleted');
      handleClose();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to delete asset';
      toast.error(message);
    },
  });

  const derivedDisplay = useMemo<DerivedAssetDisplay | null>(() => {
    if (!asset) return null;
    return {
      fileSize: formatBytes(asset.fileSize),
      createdAt: formatDateTime(asset.createdAt),
      updatedAt: formatDateTime(asset.updatedAt),
      extension: getFileExtension(asset.fileName),
    };
  }, [asset]);

  const collections = (collectionsQuery.data?.collections ?? []) as CollectionNode[];
  const labels = (labelsQuery.data?.labels ?? []) as LabelRecord[];

  const collectionOptions = useMemo<CollectionMoveOption[]>(() => {
    const flatten = (nodes: CollectionNode[], depth = 0, acc: CollectionMoveOption[] = []) => {
      nodes.forEach((node) => {
        acc.push({ id: node.id, name: node.name, depth });
        if (node.children?.length) {
          flatten(node.children, depth + 1, acc);
        }
      });
      return acc;
    };
    return flatten(collections);
  }, [collections]);

  const collectionNameById = useMemo(
    () => new Map(collectionOptions.map((option) => [option.id, option.name])),
    [collectionOptions]
  );

  const selectedCollectionLabel = collectionId
    ? (collectionNameById.get(collectionId) ?? 'Unsorted')
    : 'Unsorted';

  const handleSave = () => {
    if (!asset) return;
    updateMetadataMutation.mutate({
      title: formState.title,
      description: formState.description,
      altText: formState.altText,
    });
  };

  function handleFieldChange(field: 'title'): (event: ChangeEvent<HTMLInputElement>) => void;
  function handleFieldChange(
    field: 'description'
  ): (event: ChangeEvent<HTMLTextAreaElement>) => void;
  function handleFieldChange(field: 'altText'): (event: ChangeEvent<HTMLTextAreaElement>) => void;
  function handleFieldChange(field: keyof AssetFormState) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      setFormState((prev) => ({ ...prev, [field]: value }));
      if (!asset) return;
      setHasChanges(true);
    };
  }

  const handleReset = () => {
    if (!asset) return;
    setFormState({
      title: asset.title || '',
      description: asset.description || '',
      altText: asset.altText || '',
    });
    setCollectionId(asset.collectionId ?? null);
    setLabelIds(asset.labelIds ?? []);
    setHasChanges(false);
  };

  const handleCollectionChange = (nextCollectionId: string | null) => {
    setCollectionId(nextCollectionId);
  };

  const handleCreateLabel = async (name: string): Promise<LabelRecord> => {
    if (!brandId) throw new Error('Missing brand');
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error('Label name is required');

    try {
      const { item } = await assetsApi.createTaxonomy({
        brandId,
        type: 'LABEL',
        name: trimmedName,
      });

      const created = item as LabelRecord;
      queryClient.setQueryData<{ labels?: LabelRecord[] }>(['asset-labels', brandId], (current) => {
        const existing = current?.labels ?? [];
        if (existing.some((label) => label.id === created.id)) {
          return current ?? { labels: existing };
        }
        return {
          ...(current ?? {}),
          labels: [...existing, created].sort((a, b) => a.name.localeCompare(b.name)),
        };
      });
      void queryClient.invalidateQueries({ queryKey: ['asset-labels', brandId] });
      return created;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create label';
      toast.error(message);
      throw error instanceof Error ? error : new Error(message);
    }
  };

  const handleUploadTrigger = () => {
    uploadInputRef.current?.click();
  };

  const handleFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0];
    if (!nextFile) return;
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(nextFile);
    });
    replaceFileMutation.mutate(nextFile);
  };

  const handleDeleteAsset = () => {
    if (!asset || deleteAssetMutation.isPending) return;
    const confirmed = window.confirm('Delete this asset? This action cannot be undone.');
    if (!confirmed) return;
    deleteAssetMutation.mutate(asset.id);
  };

  const handleOpenFullPage = () => {
    if (layout === 'sidebar') {
      close();
    }
  };

  const bodyClass =
    layout === 'sidebar' ? 'flex-1 overflow-y-auto px-4 py-4' : 'flex-1 overflow-y-auto px-6 py-6';

  const containerClass = useMemo(
    () => cn('flex flex-col', layout === 'sidebar' ? 'h-full shadow-lg' : 'min-h-[60vh] w-full'),
    [layout]
  );

  const assetPreviewUrl = previewUrl || asset?.url || asset?.thumbnailUrl || '';
  const previewAlt = formState.altText || asset?.altText || asset?.fileName || 'Asset';

  return (
    <div className={containerClass} role="complementary" aria-labelledby="asset-sidebar-title">
      {showHeader ? (
        <AssetSidebarHeader
          id={id}
          asset={asset}
          layout={layout}
          onClose={handleClose}
          onOpenFullPage={handleOpenFullPage}
        />
      ) : null}

      <div className={bodyClass}>
        {(() => {
          if (assetQuery.isError) {
            return (
              <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-lg border px-4 py-3 text-sm">
                {assetQuery.error instanceof Error
                  ? assetQuery.error.message
                  : 'Failed to load asset.'}
              </div>
            );
          }

          if (assetQuery.isLoading) {
            return (
              <div className="flex min-h-[240px] items-center justify-center">
                <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
              </div>
            );
          }

          if (!asset || !derivedDisplay) {
            return (
              <div className="text-muted-foreground text-sm">
                Select an asset to view its details.
              </div>
            );
          }

          return (
            <div className="space-y-8 pb-6">
              <div className="space-y-6">
                <AssetMetadataForm
                  title={formState.title}
                  description={formState.description}
                  altText={formState.altText}
                  onTitleChange={handleFieldChange('title')}
                  onDescriptionChange={handleFieldChange('description')}
                  onAltTextChange={handleFieldChange('altText')}
                />

                <Separator />

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Collection</Label>
                    <CollectionMoveDropdown
                      onMoveToCollection={handleCollectionChange}
                      collectionOptions={collectionOptions}
                      triggerLabel={selectedCollectionLabel}
                      side="bottom"
                      align="start"
                      triggerClassName="h-10 w-full justify-between"
                      disabled={updateMetadataMutation.isPending || collectionsQuery.isLoading}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Labels</Label>
                    <AssetLabelInput
                      labels={labels}
                      value={labelIds}
                      onChange={setLabelIds}
                      onCreateLabel={handleCreateLabel}
                      disabled={labelsQuery.isLoading || updateMetadataMutation.isPending}
                    />
                  </div>
                </div>

                <Separator />

                <AssetPreviewSection
                  asset={asset}
                  assetPreviewUrl={assetPreviewUrl}
                  previewAlt={previewAlt}
                  uploadInputRef={uploadInputRef}
                  onFileSelection={handleFileSelection}
                  onUploadTrigger={handleUploadTrigger}
                  onDeleteAsset={handleDeleteAsset}
                  isReplacing={replaceFileMutation.isPending}
                  isDeleting={deleteAssetMutation.isPending}
                />

                <Separator />

                <AssetDetailsSection
                  asset={asset}
                  derivedDisplay={derivedDisplay}
                  detailsOpen={detailsOpen}
                  onToggleDetails={() => setDetailsOpen((prev) => !prev)}
                />
              </div>
            </div>
          );
        })()}
      </div>

      {asset ? (
        <AssetSidebarFooter
          hasChanges={hasChanges}
          saving={updateMetadataMutation.isPending}
          onReset={handleReset}
          onSave={handleSave}
        />
      ) : null}
    </div>
  );
}

export default AssetSidebar;
