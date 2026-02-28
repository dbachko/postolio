import { useCallback } from 'react';
import { useMutation, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { assetsApi, type AssetType, type LabelRecord } from '@/features/assets/api/client';

import { IMAGE_UPLOAD_LIMIT_BYTES, VIDEO_UPLOAD_LIMIT_BYTES } from '../constants';
import { probeImageDimensions, probeVideoMetadata } from '../utils';

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

type UpdateAssetMetadataMutationParams = {
  id?: string;
  collectionId: string | null;
  labelIds: string[];
  onAssetUpdated: (asset: AssetType) => void;
};

export function useUpdateAssetMetadataMutation({
  id,
  collectionId,
  labelIds,
  onAssetUpdated,
}: UpdateAssetMetadataMutationParams) {
  return useMutation({
    mutationFn: async (input: Partial<AssetType>) => {
      if (!id) {
        throw new Error('Missing asset id');
      }

      const { asset } = await assetsApi.updateAsset(id, {
        title: input.title,
        description: input.description,
        altText: input.altText,
        collectionId,
        labelIds,
      });
      return asset;
    },
    onSuccess: (updated) => {
      onAssetUpdated(updated);
      toast.success('Asset details updated');
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'Failed to update asset'));
    },
  });
}

type ReplaceAssetFileMutationParams = {
  asset: AssetType | undefined;
  onAssetUpdated: (asset: AssetType) => void;
  onSettled: () => void;
};

export function useReplaceAssetFileMutation({
  asset,
  onAssetUpdated,
  onSettled,
}: ReplaceAssetFileMutationParams) {
  return useMutation({
    mutationFn: async (file: File) => {
      if (!asset) {
        throw new Error('Asset not loaded');
      }

      const isImage = file.type.startsWith('image/');
      const fileType = isImage ? 'image' : 'video';
      const limit = isImage ? IMAGE_UPLOAD_LIMIT_BYTES : VIDEO_UPLOAD_LIMIT_BYTES;
      if (file.size > limit) {
        const maxSizeMb = Math.floor(limit / (1024 * 1024));
        throw new Error(`Please upload ${fileType}s smaller than ${maxSizeMb}MB.`);
      }

      const uploadInfo = await assetsApi.getUploadUrl({
        brandId: asset.brandId,
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        fileType,
        fileSize: file.size,
      });

      await assetsApi.uploadToS3(file, uploadInfo.uploadUrl);
      const dimensions = isImage
        ? await probeImageDimensions(file)
        : await probeVideoMetadata(file);
      const { asset: updated } = await assetsApi.updateAsset(asset.id, {
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileType,
        fileSize: file.size,
        s3Key: uploadInfo.s3Key,
        width: dimensions.width,
        height: dimensions.height,
        duration: dimensions.duration,
      });
      return updated;
    },
    onSuccess: (updated) => {
      onAssetUpdated(updated);
      toast.success('Asset file replaced');
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'Failed to replace asset file'));
    },
    onSettled,
  });
}

type DeleteAssetMutationParams = {
  onDeleted: (assetId: string) => void;
};

export function useDeleteAssetMutation({ onDeleted }: DeleteAssetMutationParams) {
  return useMutation({
    mutationFn: async (assetId: string) => {
      await assetsApi.deleteAsset(assetId);
      return assetId;
    },
    onSuccess: (deletedId) => {
      onDeleted(deletedId);
      toast.success('Asset deleted');
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'Failed to delete asset'));
    },
  });
}

type CreateAssetLabelParams = {
  brandId: string | undefined;
  queryClient: QueryClient;
};

export function useCreateAssetLabel({ brandId, queryClient }: CreateAssetLabelParams) {
  return useCallback(
    async (name: string): Promise<LabelRecord> => {
      if (!brandId) {
        throw new Error('Missing brand');
      }

      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new Error('Label name is required');
      }

      try {
        const { item } = await assetsApi.createTaxonomy({
          brandId,
          type: 'LABEL',
          name: trimmedName,
        });
        const created = item as LabelRecord;

        queryClient.setQueryData<{ labels?: LabelRecord[] }>(
          ['asset-labels', brandId],
          (current) => {
            const existing = current?.labels ?? [];
            if (existing.some((label) => label.id === created.id)) {
              return current ?? { labels: existing };
            }

            return {
              ...(current ?? {}),
              labels: [...existing, created].sort((a, b) => a.name.localeCompare(b.name)),
            };
          }
        );

        void queryClient.invalidateQueries({ queryKey: ['asset-labels', brandId] });
        return created;
      } catch (error) {
        const message = getErrorMessage(error, 'Failed to create label');
        toast.error(message);
        throw error instanceof Error ? error : new Error(message);
      }
    },
    [brandId, queryClient]
  );
}
