import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useBrandStore } from '@/stores/brandStore';
import { brand as brandApi } from '@/lib/api';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';

import { AppEmptyState } from '@/components/AppEmptyState';
import {
  SocialAccountQueueSettingsPanel,
  type SocialAccountOption,
} from '@/components/social/SocialAccountQueueSettingsDialog';
import { SocialAccountAvatar } from '@/components/social/SocialAccountAvatar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Platform } from '@/lib/platform-config';

type ConnectedAccount = {
  id: string;
  platform: string;
  externalAccountId?: string | null;
  username?: string | null;
  displayName?: string | null;
  profilePictureUrl?: string | null;
  disconnected?: boolean;
};

type AccountOption = SocialAccountOption & { profilePictureUrl?: string | null };

function toAccountOption(a: ConnectedAccount): AccountOption {
  return {
    id: a.id,
    platform: a.platform,
    username: a.username ?? null,
    displayName: a.displayName ?? null,
    externalAccountId: a.externalAccountId ?? null,
    profilePictureUrl: a.profilePictureUrl ?? null,
  };
}

function accountTitle(account: AccountOption): string {
  return account.displayName || account.username || account.externalAccountId || account.id;
}

function accountSubtitle(account: AccountOption): string | null {
  if (account.username) return `@${account.username}`;
  if (account.externalAccountId) return account.externalAccountId;
  return null;
}

export function SocialAccountsPublishingSchedule() {
  const selectedBrand = useBrandStore((s) => s.selectedBrand);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');

  const accountsQuery = useQuery({
    queryKey: ['brand-social-accounts', selectedBrand?.id],
    queryFn: () => brandApi.getConnectedAccounts(selectedBrand!.id),
    enabled: Boolean(selectedBrand?.id),
    staleTime: CACHE_TIMES.STANDARD,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });

  const connectedAccounts = useMemo(() => {
    const data = accountsQuery.data as any;
    const list = Array.isArray(data?.socialAccounts)
      ? (data.socialAccounts as ConnectedAccount[])
      : [];
    return list.filter((a) => !a.disconnected);
  }, [accountsQuery.data]);

  const allAccountOptions = useMemo(
    () => connectedAccounts.map((a) => toAccountOption(a)),
    [connectedAccounts]
  );

  useEffect(() => {
    if (!connectedAccounts.length) {
      setSelectedAccountId('');
      return;
    }
    if (selectedAccountId && connectedAccounts.some((a) => a.id === selectedAccountId)) return;
    setSelectedAccountId(connectedAccounts[0]!.id);
  }, [connectedAccounts, selectedAccountId]);

  const selectedAccount = useMemo(() => {
    if (!selectedAccountId) return null;
    return allAccountOptions.find((a) => a.id === selectedAccountId) || null;
  }, [allAccountOptions, selectedAccountId]);

  if (!selectedBrand) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AppEmptyState
          variant="minimal"
          title="Select a brand to manage social accounts"
          description="Choose which brand you want to manage to connect accounts and configure a publishing schedule."
          actions={[{ label: 'Choose Brand', to: '/brands' }]}
        />
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {accountsQuery.isLoading ? (
          <div className="bg-muted h-20 animate-pulse rounded" />
        ) : allAccountOptions.length === 0 ? (
          <div className="text-muted-foreground text-sm">
            No connected accounts yet. Connect an account in the Connections page first.
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <div className="space-y-2 lg:hidden">
              <div className="text-sm font-medium">Social accounts</div>
              <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1">
                {allAccountOptions.map((account) => {
                  const selected = account.id === selectedAccountId;
                  const title = accountTitle(account);
                  return (
                    <Button
                      key={account.id}
                      type="button"
                      aria-label={title}
                      onClick={() => setSelectedAccountId(account.id)}
                      variant="ghost"
                      size="icon-sm"
                      className={cn(
                        'rounded-full',
                        selected
                          ? 'ring-primary ring-offset-background ring-2 ring-offset-2'
                          : 'ring-border ring-1'
                      )}
                      title={title}
                    >
                      <SocialAccountAvatar
                        platform={account.platform as Platform}
                        name={title}
                        src={account.profilePictureUrl}
                        size="sm"
                        selected={selected}
                        muted={false}
                      />
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="hidden space-y-2 lg:block">
              <div className="text-sm font-medium">Social accounts</div>
              <div className="space-y-2">
                {allAccountOptions.map((account) => {
                  const selected = account.id === selectedAccountId;
                  const title = accountTitle(account);
                  const subtitle = accountSubtitle(account);
                  return (
                    <Button
                      key={account.id}
                      type="button"
                      onClick={() => setSelectedAccountId(account.id)}
                      variant="ghost"
                      className={cn(
                        'bg-card hover:bg-accent h-auto w-full justify-start gap-3 rounded-lg border p-3 text-left transition-colors',
                        selected ? 'border-primary ring-primary/20 ring-1' : 'border-border'
                      )}
                    >
                      <SocialAccountAvatar
                        platform={account.platform as Platform}
                        name={title}
                        src={account.profilePictureUrl}
                        size="sm"
                        selected={selected}
                        muted={false}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="truncate text-sm font-medium">{title}</div>
                        </div>
                        {subtitle ? (
                          <div className="text-muted-foreground truncate text-xs">{subtitle}</div>
                        ) : null}
                      </div>
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border p-3 sm:p-4">
              <SocialAccountQueueSettingsPanel
                account={selectedAccount}
                allAccounts={allAccountOptions}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
