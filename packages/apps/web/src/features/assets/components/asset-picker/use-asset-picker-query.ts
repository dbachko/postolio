import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { assetsApi } from '@/features/assets/api/client';
import {
  sortAssets,
  type AssetTypeFilter,
  type SortDirection,
  type SortField,
} from '../asset-utils';
import type { AssetFilters } from '../FilterPanel';

interface UseAssetPickerQueryArgs {
  brandId: string;
  debouncedSearch: string;
  type?: 'image' | 'video';
  typeFilter: AssetTypeFilter;
  filters: AssetFilters;
  sortField: SortField;
  sortDirection: SortDirection;
}

export function useAssetPickerQuery({
  brandId,
  debouncedSearch,
  type,
  typeFilter,
  filters,
  sortField,
  sortDirection,
}: UseAssetPickerQueryArgs) {
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useInfiniteQuery({
    queryKey: ['assets-picker', brandId, debouncedSearch, type ?? typeFilter, filters],
    queryFn: ({ pageParam = 1 }) =>
      assetsApi.listAssets({
        brandId,
        page: pageParam,
        limit: 30,
        search: debouncedSearch,
        type: type ?? (typeFilter === 'all' ? undefined : typeFilter),
        aspectRatios: filters.aspectRatios.length > 0 ? filters.aspectRatios : undefined,
        orientationTypes:
          filters.orientationTypes.length > 0 ? filters.orientationTypes : undefined,
        uploadedAfter: filters.recentOnly
          ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
          : undefined,
        usage: filters.usageStatuses.length === 1 ? filters.usageStatuses[0] : undefined,
      }),
    enabled: !!brandId,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.page < lastPage.pagination.totalPages
        ? lastPage.pagination.page + 1
        : undefined,
    initialPageParam: 1,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });

  const assets = useMemo(() => data?.pages.flatMap((page) => page.assets) ?? [], [data?.pages]);
  const sortedAssets = useMemo(
    () => sortAssets(assets, sortField, sortDirection),
    [assets, sortDirection, sortField]
  );

  return {
    assets,
    sortedAssets,
    isLoading,
    isFetchingNextPage,
    hasNextPage: !!hasNextPage,
    fetchNextPage,
  };
}
