import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';

import { assetsApi, type AssetType } from '@/features/assets/api/client';

import type { AssetFilters } from '../FilterPanel';
import {
  groupByMonth,
  sortAssets,
  type AssetTypeFilter,
  type SortDirection,
  type SortField,
} from '../asset-utils';
import { UNSORTED_COLLECTION_PARAM } from './constants';

type UseAssetLibraryAssetsStateParams = {
  brandId?: string;
  search: string;
  typeFilter: AssetTypeFilter;
  filters: AssetFilters;
  collectionId: string | null;
  labelIds: string[];
  sortField: SortField;
  sortDirection: SortDirection;
};

type AssetsQueryParams = Omit<UseAssetLibraryAssetsStateParams, 'sortField' | 'sortDirection'>;

export type AssetLibraryAssetsState = {
  groupedAssets: Record<string, AssetType[]>;
  sortedAssets: AssetType[];
  loadMoreRef: RefObject<HTMLDivElement | null>;
  isLoading: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
};

function createAssetsQueryFn({
  brandId,
  search,
  typeFilter,
  filters,
  collectionId,
  labelIds,
}: AssetsQueryParams) {
  return ({ pageParam = 1 }: { pageParam: number }) => {
    const usageFilter = filters.usageStatuses.length === 1 ? filters.usageStatuses[0] : undefined;
    const recentAfter = filters.recentOnly
      ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      : undefined;

    return assetsApi.listAssets({
      brandId,
      page: pageParam,
      limit: 30,
      search,
      type: typeFilter === 'all' ? undefined : typeFilter,
      collectionId: collectionId || undefined,
      includeSubcollections:
        collectionId && collectionId !== UNSORTED_COLLECTION_PARAM ? true : undefined,
      labelIds: labelIds.length > 0 ? labelIds : undefined,
      labelMode: 'any',
      aspectRatios: filters.aspectRatios.length > 0 ? filters.aspectRatios : undefined,
      orientationTypes: filters.orientationTypes.length > 0 ? filters.orientationTypes : undefined,
      minWidth: filters.minWidth,
      maxWidth: filters.maxWidth,
      minHeight: filters.minHeight,
      maxHeight: filters.maxHeight,
      uploadedAfter: recentAfter || filters.uploadedAfter,
      uploadedBefore: filters.uploadedBefore,
      usage: usageFilter,
    });
  };
}

export function useAssetLibraryAssetsState(
  params: UseAssetLibraryAssetsStateParams
): AssetLibraryAssetsState {
  const query = useInfiniteQuery({
    queryKey: [
      'assets',
      params.brandId,
      params.search,
      params.typeFilter,
      params.filters,
      params.collectionId,
      params.labelIds,
    ],
    queryFn: createAssetsQueryFn(params),
    enabled: Boolean(params.brandId),
    getNextPageParam: (lastPage) =>
      lastPage.pagination.page < lastPage.pagination.totalPages
        ? lastPage.pagination.page + 1
        : undefined,
    initialPageParam: 1,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });

  const allAssets = useMemo(
    () => query.data?.pages.flatMap((page) => page.assets) ?? [],
    [query.data?.pages]
  );
  const sortedAssets = useMemo(
    () => sortAssets(allAssets, params.sortField, params.sortDirection),
    [allAssets, params.sortDirection, params.sortField]
  );
  const groupedAssets = useMemo(() => groupByMonth(sortedAssets), [sortedAssets]);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || !hasNextPage) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: '320px 0px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, sortedAssets.length]);

  return {
    groupedAssets,
    sortedAssets,
    loadMoreRef,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
  };
}
