import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import {
  assetsApi,
  type AssetType,
  type CollectionNode,
  type LabelRecord,
} from '@/features/assets/api/client';
import type { CollectionMoveOption } from '@/features/assets/components/collection-move-dropdown';

import type { DerivedAssetDisplay } from '../types';
import { formatBytes, formatDateTime, getFileExtension } from '../utils';

function flattenCollectionOptions(
  nodes: CollectionNode[],
  depth = 0,
  acc: CollectionMoveOption[] = []
): CollectionMoveOption[] {
  for (const node of nodes) {
    acc.push({ id: node.id, name: node.name, depth });
    if (node.children?.length) {
      flattenCollectionOptions(node.children, depth + 1, acc);
    }
  }
  return acc;
}

function buildDerivedDisplay(asset: AssetType | undefined): DerivedAssetDisplay | null {
  if (!asset) {
    return null;
  }

  return {
    fileSize: formatBytes(asset.fileSize),
    createdAt: formatDateTime(asset.createdAt),
    updatedAt: formatDateTime(asset.updatedAt),
    extension: getFileExtension(asset.fileName),
  };
}

export function useAssetSidebarQueries(id?: string) {
  const assetQuery = useQuery({
    queryKey: ['asset', id],
    queryFn: async (): Promise<AssetType> => {
      const response = await assetsApi.getAsset(id as string);
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

  const collections = useMemo(() => {
    const next = collectionsQuery.data?.collections;
    return Array.isArray(next) ? (next as CollectionNode[]) : [];
  }, [collectionsQuery.data?.collections]);
  const labels = useMemo(() => {
    const next = labelsQuery.data?.labels;
    return Array.isArray(next) ? (next as LabelRecord[]) : [];
  }, [labelsQuery.data?.labels]);

  const collectionOptions = useMemo(() => flattenCollectionOptions(collections), [collections]);
  const collectionNameById = useMemo(
    () => new Map(collectionOptions.map((option) => [option.id, option.name])),
    [collectionOptions]
  );
  const derivedDisplay = useMemo(() => buildDerivedDisplay(asset), [asset]);

  return {
    asset,
    brandId,
    assetQuery,
    collectionsQuery,
    labelsQuery,
    labels,
    collectionOptions,
    collectionNameById,
    derivedDisplay,
  };
}
