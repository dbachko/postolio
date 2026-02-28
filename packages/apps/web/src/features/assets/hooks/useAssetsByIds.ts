import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { assetsApi, type Asset } from '@/features/assets/api/client';

export type AssetsById = Record<string, Asset | null>;

export function useAssetsByIds(assetIds: Array<string | null | undefined>) {
  const normalized = useMemo(() => {
    return Array.from(
      new Set(
        assetIds
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          .map((id) => id.trim())
      )
    );
  }, [assetIds]);

  const cacheKey = useMemo(() => normalized.slice().sort().join(','), [normalized]);

  return useQuery({
    queryKey: ['assets', 'batch', cacheKey],
    queryFn: async () => {
      const result = await assetsApi.getBatchAssets(normalized);
      return result.assets as AssetsById;
    },
    enabled: normalized.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
