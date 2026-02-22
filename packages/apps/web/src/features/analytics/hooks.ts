import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { analytics, brand as brandApi } from '@/lib/api';
import type {
  AccountHealthScore,
  AccountPostsResponse,
  AccountSummary,
  AIInsight,
  ConnectedAccountsResponse,
  ForecastsData,
  Period,
  RecommendationsData,
} from './types';

export function useConnectedAccounts(brandId?: string) {
  return useQuery<ConnectedAccountsResponse>({
    queryKey: ['connected-accounts', brandId],
    enabled: Boolean(brandId),
    queryFn: async () => brandApi.getConnectedAccounts(brandId!),
    staleTime: 30_000,
  });
}

export function useAccountSummary(socialAccountId?: string, period: Period = '30d') {
  return useQuery<{ success: boolean; data: AccountSummary }>({
    queryKey: ['account-summary', socialAccountId, period],
    enabled: Boolean(socialAccountId),
    queryFn: async () => analytics.getSocialAccountSummary(socialAccountId!, period),
    staleTime: 30_000,
  });
}

export function useAccountHealth(socialAccountId?: string, period: Period = '30d') {
  return useQuery<{ success: boolean; data: AccountHealthScore }>({
    queryKey: ['account-health', socialAccountId, period],
    enabled: Boolean(socialAccountId),
    queryFn: async () => analytics.getSocialAccountHealth(socialAccountId!, period),
    staleTime: 30_000,
  });
}

export function useAccountPosts(params: {
  socialAccountId?: string;
  period: Period;
  sortBy: 'publishedAt' | 'engagement' | 'reach' | 'engagementRate';
  order: 'asc' | 'desc';
  limit: number;
  offset: number;
}) {
  const { socialAccountId, period, sortBy, order, limit, offset } = params;
  return useQuery<AccountPostsResponse>({
    queryKey: ['account-posts', socialAccountId, period, sortBy, order, limit, offset],
    enabled: Boolean(socialAccountId),
    queryFn: async () =>
      analytics.getSocialAccountPosts(socialAccountId!, { period, sortBy, order, limit, offset }),
    staleTime: 30_000,
  });
}

export function useAccountTopPosts(socialAccountId?: string, period: Period = '30d') {
  return useQuery<AccountPostsResponse>({
    queryKey: ['account-top-posts', socialAccountId, period],
    enabled: Boolean(socialAccountId),
    queryFn: async () =>
      analytics.getSocialAccountPosts(socialAccountId!, {
        period,
        sortBy: 'engagementRate',
        order: 'desc',
        limit: 50,
        offset: 0,
      }),
    staleTime: 30_000,
  });
}

export function useAccountAIInsights(socialAccountId?: string, days = 30) {
  return useQuery<AIInsight[]>({
    queryKey: ['account-ai-insights', socialAccountId, days],
    enabled: Boolean(socialAccountId),
    queryFn: async () => {
      const res = await analytics.getSocialAccountAIInsights(socialAccountId!, days);
      return res.data?.insights || [];
    },
    staleTime: 30_000,
  });
}

export function useAccountRecommendations(socialAccountId?: string, days = 90) {
  return useQuery<RecommendationsData | null>({
    queryKey: ['account-recommendations', socialAccountId, days],
    enabled: Boolean(socialAccountId),
    queryFn: async () => {
      const res = await analytics.getSocialAccountRecommendations(socialAccountId!, days);
      return res.data || null;
    },
    staleTime: 30_000,
  });
}

export function useAccountForecasts(socialAccountId?: string, days = 30, historical = 90) {
  return useQuery<ForecastsData | null>({
    queryKey: ['account-forecasts', socialAccountId, days, historical],
    enabled: Boolean(socialAccountId),
    queryFn: async () => {
      const res = await analytics.getSocialAccountForecasting(socialAccountId!, days, historical);
      return res.data?.forecasts || null;
    },
    staleTime: 30_000,
  });
}

export function useRefreshAccountAnalytics(socialAccountId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['account-refresh', socialAccountId],
    mutationFn: async () => analytics.refreshSocialAccountAnalytics(socialAccountId!),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['account-summary', socialAccountId] }),
        queryClient.invalidateQueries({ queryKey: ['account-health', socialAccountId] }),
        queryClient.invalidateQueries({ queryKey: ['account-posts', socialAccountId] }),
        queryClient.invalidateQueries({ queryKey: ['account-top-posts', socialAccountId] }),
        queryClient.invalidateQueries({ queryKey: ['account-ai-insights', socialAccountId] }),
        queryClient.invalidateQueries({ queryKey: ['account-forecasts', socialAccountId] }),
        queryClient.invalidateQueries({ queryKey: ['account-recommendations', socialAccountId] }),
      ]);
    },
  });
}
