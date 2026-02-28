import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { useBrandStore } from '@/stores/brandStore';
import {
  useAccountAIInsights,
  useAccountForecasts,
  useAccountHealth,
  useAccountPosts,
  useAccountRecommendations,
  useAccountSummary,
  useAccountTopPosts,
  useConnectedAccounts,
  useRefreshAccountAnalytics,
} from '@/features/analytics/hooks';
import { type AnalyticsTabKey, getPlatformAnalyticsModule } from '@/features/analytics/platforms';
import { daysFromPeriod } from '@/features/analytics/utils';
import type { AccountPost, Period } from '@/features/analytics/types';

import type { AnalyticsPost, AnalyticsPostsSortBy } from './types';

interface TabSyncOptions {
  selectedTabParam: AnalyticsTabKey;
  tab: AnalyticsTabKey;
  setSearchParams: ReturnType<typeof useSearchParams>[1];
}

function normalizePosts(posts: AccountPost[] | undefined): AnalyticsPost[] {
  return (posts || []).map((post) => ({
    ...post,
    thumbnailUrl: post.thumbnailUrl ?? undefined,
    permalink: post.permalink ?? undefined,
    publishedAt: post.publishedAt ?? undefined,
  }));
}

function resolveTab(selectedTabParam: string | null, tabs: AnalyticsTabKey[]): AnalyticsTabKey {
  const nextTab = (selectedTabParam || 'overview') as AnalyticsTabKey;
  return tabs.includes(nextTab) ? nextTab : 'overview';
}

function useSyncedTab({ selectedTabParam, tab, setSearchParams }: TabSyncOptions) {
  useEffect(() => {
    if (tab !== selectedTabParam) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('tab', tab);
          return next;
        },
        { replace: true }
      );
    }
  }, [selectedTabParam, setSearchParams, tab]);
}

export function useAnalyticsAccountPageState() {
  const navigate = useNavigate();
  const { socialAccountId } = useParams<{ socialAccountId: string }>();
  const { selectedBrand } = useBrandStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const [period, setPeriod] = useState<Period>('30d');
  const [postsSortBy, setPostsSortBy] = useState<AnalyticsPostsSortBy>('publishedAt');
  const [postsOrder, setPostsOrder] = useState<'asc' | 'desc'>('desc');
  const [postsOffset, setPostsOffset] = useState(0);
  const days = daysFromPeriod(period);
  const accountsQuery = useConnectedAccounts(selectedBrand?.id);
  const accounts = useMemo(() => accountsQuery.data?.socialAccounts || [], [accountsQuery.data]);
  const currentAccount = useMemo(
    () =>
      socialAccountId ? accounts.find((account) => account.id === socialAccountId) || null : null,
    [accounts, socialAccountId]
  );
  const platformModule = useMemo(
    () => getPlatformAnalyticsModule(currentAccount?.platform),
    [currentAccount?.platform]
  );
  const selectedTabParam = (searchParams.get('tab') || 'overview') as AnalyticsTabKey;
  const tab = resolveTab(selectedTabParam, platformModule.tabs);
  useSyncedTab({ selectedTabParam, tab, setSearchParams });

  const summaryQuery = useAccountSummary(socialAccountId, period);
  const healthQuery = useAccountHealth(socialAccountId, period);
  const postsQuery = useAccountPosts({
    socialAccountId: tab === 'posts' ? socialAccountId : undefined,
    period,
    sortBy: postsSortBy,
    order: postsOrder,
    limit: 20,
    offset: postsOffset,
  });
  const topPostsQuery = useAccountTopPosts(socialAccountId, period);
  const insightsQuery = useAccountAIInsights(socialAccountId, days);
  const forecastsQuery = useAccountForecasts(socialAccountId, 30, 90);
  const recommendationsQuery = useAccountRecommendations(socialAccountId, 90);
  const refreshMutation = useRefreshAccountAnalytics(socialAccountId);

  return {
    navigate,
    socialAccountId,
    setSearchParams,
    period,
    setPeriod,
    tab,
    platformTabs: platformModule.tabs,
    accounts,
    summary: summaryQuery.data?.data || null,
    summaryQuery,
    healthScore: healthQuery.data?.data || null,
    healthQuery,
    topPosts: normalizePosts(topPostsQuery.data?.data),
    topPostsQuery,
    posts: normalizePosts(postsQuery.data?.data),
    postsQuery,
    pagination: postsQuery.data?.pagination,
    postsSortBy,
    setPostsSortBy,
    postsOrder,
    setPostsOrder,
    setPostsOffset,
    insightsQuery,
    forecastsQuery,
    recommendationsQuery,
    refreshMutation,
  };
}
