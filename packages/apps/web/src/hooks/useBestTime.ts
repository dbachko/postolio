import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { brand as brandApi } from '@/lib/api';
import type { BestTimePayload, BestTimeStatus } from '@/lib/api/types';
import { CACHE_TIMES } from '@/lib/cache-config';

export function useInstagramBestTime(brandId?: string) {
  const enabled = !!brandId;
  const { data, isLoading, isFetching, isError, refetch } = useQuery<BestTimePayload>({
    queryKey: ['instagram-best-time', brandId],
    enabled,
    queryFn: async () => {
      const res = await brandApi.getInstagramBestTime(brandId!);
      return res as BestTimePayload;
    },
    staleTime: CACHE_TIMES.LONG,
  });

  return { data, isLoading, isFetching, isError, refetch };
}

export function useInstagramBestTimeStatus(brandId?: string) {
  const enabled = !!brandId;
  return useQuery<BestTimeStatus>({
    queryKey: ['instagram-best-time-status', brandId],
    enabled,
    queryFn: async () => brandApi.getInstagramBestTimeStatus(brandId!) as Promise<BestTimeStatus>,
    refetchInterval: CACHE_TIMES.STANDARD,
  });
}

export function useRefreshInstagramBestTime(brandId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['refresh-instagram-best-time', brandId],
    mutationFn: async () => brandApi.refreshInstagramBestTime(brandId!),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['instagram-best-time', brandId] }),
        qc.invalidateQueries({ queryKey: ['instagram-best-time-status', brandId] }),
      ]);
    },
  });
}
