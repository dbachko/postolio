import { useQuery } from '@tanstack/react-query';

import { httpGet } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';

export interface ScheduleAheadLimits {
  tier: string;
  maxAllowed: number;
  currentCount: number;
}

export interface BrandLimitBreakdown {
  brandId: string;
  brandName: string;
  scheduled: number;
  draft: number;
  totalFuture: number;
}

export function useLimitsData() {
  const user = useAuthStore((state) => state.user);

  const limitsQuery = useQuery({
    queryKey: ['limits', 'schedule-ahead'],
    queryFn: async () => httpGet('/api/account/limits/schedule-ahead'),
    staleTime: 60 * 1000,
  });

  const perBrandQuery = useQuery({
    queryKey: ['limits', 'schedule-ahead', 'by-brand'],
    queryFn: async () => httpGet('/api/account/limits/schedule-ahead/by-brand'),
    staleTime: 60 * 1000,
  });

  const limits = limitsQuery.data?.data as ScheduleAheadLimits | undefined;
  const perBrand = (perBrandQuery.data?.data as BrandLimitBreakdown[] | undefined) || [];
  const effectiveTier = limits?.tier || user?.subscriptionTier || 'free';

  return {
    limits,
    perBrand,
    effectiveTier,
    isLimitsLoading: limitsQuery.isLoading,
    isPerBrandLoading: perBrandQuery.isLoading,
  };
}
