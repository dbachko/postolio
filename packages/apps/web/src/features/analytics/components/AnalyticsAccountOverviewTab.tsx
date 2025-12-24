import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SocialAccountAvatar } from '@/components/social/SocialAccountAvatar';
import { KPICard, AccountHealthScore } from '@/components/analytics-common';
import type { ConnectedAccount, Period } from '@/features/analytics/types';
import { useAccountHealth, useAccountSummary } from '@/features/analytics/hooks';
import { getAccountDisplayName } from '@/features/analytics/utils';
import { getPlatformAnalyticsModule, type AnalyticsTabKey } from '@/features/analytics/platforms';
import type { Platform } from '@/lib/platform-config';
import { formatNumber, formatPercent } from '@/utils/formatNumber';
import { useNavigate } from 'react-router-dom';

export function AnalyticsAccountTabLabel({ account }: { account: ConnectedAccount }) {
  const title = getAccountDisplayName(account);
  const platform = (account.platform || 'instagram') as Platform;

  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <SocialAccountAvatar
        platform={platform}
        name={title}
        src={account.profilePictureUrl || null}
        size="sm"
        muted={account.disconnected}
        disabled={account.disconnected}
      />
      <span className="max-w-[140px] truncate text-sm font-medium">{title}</span>
    </span>
  );
}

const LINK_TABS: AnalyticsTabKey[] = ['posts', 'insights', 'recommendations', 'forecasts'];

export function AnalyticsAccountOverviewTab({
  account,
  period,
  onOpenTab,
}: {
  account: ConnectedAccount;
  period: Period;
  onOpenTab: (tab: AnalyticsTabKey) => void;
}) {
  const navigate = useNavigate();
  const platformModule = getPlatformAnalyticsModule(account.platform);
  const summaryQuery = useAccountSummary(account.disconnected ? undefined : account.id, period);
  const healthQuery = useAccountHealth(account.disconnected ? undefined : account.id, period);

  if (account.disconnected) {
    return (
      <Alert>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>This account is disconnected.</span>
          <Button variant="outline" onClick={() => navigate('/social-accounts')}>
            Manage connections
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (summaryQuery.isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-24 w-full rounded-lg" />
              ))}
            </div>
            <Skeleton className="h-64 w-full rounded-lg" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (summaryQuery.isError || !summaryQuery.data?.data) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Unable to load analytics for this account.</AlertDescription>
      </Alert>
    );
  }

  const summary = summaryQuery.data.data;
  const linkTabs = platformModule.tabs.filter((t) => LINK_TABS.includes(t));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Posts"
          value={formatNumber(summary.totalPosts || 0)}
          change={summary.previousPeriodComparison?.totalPosts?.change}
          loading={false}
        />
        <KPICard
          title="Views"
          value={formatNumber(summary.totalImpressions || 0)}
          change={summary.previousPeriodComparison?.impressions?.change}
          loading={false}
        />
        <KPICard
          title="Reach"
          value={formatNumber(summary.totalReach || 0)}
          change={summary.previousPeriodComparison?.reach?.change}
          loading={false}
        />
        <KPICard
          title="Engagement Rate"
          value={formatPercent(summary.averageEngagementRate || 0)}
          change={summary.previousPeriodComparison?.engagementRate?.change}
          loading={false}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {linkTabs.map((t) => (
          <Button key={t} type="button" variant="outline" onClick={() => onOpenTab(t)}>
            {t === 'posts'
              ? 'Posts'
              : t === 'insights'
                ? 'AI Insights'
                : t === 'recommendations'
                  ? 'Recommendations'
                  : 'Forecasts'}
          </Button>
        ))}
      </div>

      <AccountHealthScore
        healthScore={healthQuery.data?.data || undefined}
        loading={healthQuery.isLoading}
      />
    </div>
  );
}
