import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { brand as brandApi } from '@/lib/api';
import { useBrandStore } from '@/stores/brandStore';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { X } from 'lucide-react';
import {
  SocialAccountQueueSettingsPanel,
  type SocialAccountOption,
} from '@/components/social/SocialAccountQueueSettingsDialog';

type ConnectedAccount = {
  id: string;
  platform: string;
  externalAccountId?: string | null;
  username?: string | null;
  displayName?: string | null;
  profilePictureUrl?: string | null;
  disconnected?: boolean;
};

function toAccountOption(a: ConnectedAccount): SocialAccountOption {
  return {
    id: a.id,
    platform: a.platform,
    username: a.username ?? null,
    displayName: a.displayName ?? null,
    externalAccountId: a.externalAccountId ?? null,
    profilePictureUrl: a.profilePictureUrl ?? null,
  };
}

export function PublishingScheduleSidebar({ id }: { id?: string }) {
  const { close } = useRightSidebarRouter();
  const selectedBrand = useBrandStore((s) => s.selectedBrand);
  const accountId = typeof id === 'string' && id.trim().length ? id.trim() : null;

  const accountsQuery = useQuery({
    queryKey: ['brand-social-accounts', selectedBrand?.id],
    queryFn: () => brandApi.getConnectedAccounts(selectedBrand!.id),
    enabled: Boolean(selectedBrand?.id),
    staleTime: CACHE_TIMES.STANDARD,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });

  const allAccounts = useMemo(() => {
    const data = accountsQuery.data as any;
    const list = Array.isArray(data?.socialAccounts)
      ? (data.socialAccounts as ConnectedAccount[])
      : [];
    return list.filter((a) => !a.disconnected).map(toAccountOption);
  }, [accountsQuery.data]);

  const selectedAccount = useMemo(() => {
    if (!accountId) return null;
    return allAccounts.find((account) => account.id === accountId) ?? null;
  }, [accountId, allAccounts]);

  return (
    <div className="flex h-full flex-col">
      <div className="bg-card sticky top-0 z-30 flex h-12 items-center justify-between border-b px-4">
        <Breadcrumb aria-label="right-sidebar-title">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Publishing Schedule</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <Button variant="ghost" size="icon" onClick={close} aria-label="Close sidebar">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 px-4 py-4">
        {!selectedBrand ? (
          <div className="text-muted-foreground text-sm">
            Select a brand to configure publishing time slots.
          </div>
        ) : accountsQuery.isLoading ? (
          <div className="bg-muted h-24 animate-pulse rounded-lg" />
        ) : (
          <SocialAccountQueueSettingsPanel
            account={selectedAccount}
            allAccounts={allAccounts}
            onClose={close}
          />
        )}
      </ScrollArea>
    </div>
  );
}
