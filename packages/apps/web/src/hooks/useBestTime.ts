import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { brand as brandApi } from '@/lib/api';
import type { BestTimePayload, BestTimeStatus } from '@/lib/api/types';
import { CACHE_TIMES } from '@/lib/cache-config';

export function useInstagramBestTime(brandId?: string) {
  const enabled = Boolean(brandId);
  const { data, isLoading, isFetching, isError, refetch } = useQuery<BestTimePayload>({
    queryKey: ['instagram-best-time', brandId],
    enabled,
    queryFn: async () => brandApi.getInstagramBestTime(brandId!) as Promise<BestTimePayload>,
    staleTime: CACHE_TIMES.LONG,
  });

  return { data, isLoading, isFetching, isError, refetch };
}

export function useInstagramBestTimeStatus(brandId?: string) {
  const enabled = Boolean(brandId);
  return useQuery<BestTimeStatus>({
    queryKey: ['instagram-best-time-status', brandId],
    enabled,
    queryFn: async () => brandApi.getInstagramBestTimeStatus(brandId!) as Promise<BestTimeStatus>,
    refetchInterval: CACHE_TIMES.STANDARD,
  });
}

export function useRefreshInstagramBestTime(brandId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['refresh-instagram-best-time', brandId],
    mutationFn: async () => brandApi.refreshInstagramBestTime(brandId!),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['instagram-best-time', brandId] }),
        queryClient.invalidateQueries({ queryKey: ['instagram-best-time-status', brandId] }),
      ]);
    },
  });
}
