import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AnalyticsPeriodSelect } from '@/features/analytics/components/AnalyticsPeriodSelect';
import { getPlatformIcon } from '@/components/icons/platform-icons';
import type { ConnectedAccount, Period } from '@/features/analytics/types';

interface AccountSelectorTabsProps {
  socialAccountId: string;
  accounts: ConnectedAccount[];
  period: Period;
  refreshPending: boolean;
  onAccountChange: (nextId: string) => void;
  onPeriodChange: (nextPeriod: Period) => void;
  onRefresh: () => void;
}

export function AccountSelectorTabs({
  socialAccountId,
  accounts,
  period,
  refreshPending,
  onAccountChange,
  onPeriodChange,
  onRefresh,
}: AccountSelectorTabsProps) {
  return (
    <Tabs value={socialAccountId} onValueChange={onAccountChange}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList className="h-auto flex-wrap justify-start">
          {accounts.map((account) => (
            <TabsTrigger
              key={account.id}
              value={account.id}
              disabled={account.disconnected}
              className="gap-2"
            >
              {getPlatformIcon(account.platform)}
              <span>{account.displayName || account.username || 'Account'}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="flex flex-wrap items-center gap-3">
          <AnalyticsPeriodSelect value={period} onChange={onPeriodChange} />
          <Button variant="outline" onClick={onRefresh} disabled={refreshPending}>
            {refreshPending ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>
    </Tabs>
  );
}
