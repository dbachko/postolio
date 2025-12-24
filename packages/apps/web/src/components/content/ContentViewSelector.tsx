import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Layers, Loader2 } from 'lucide-react';

import { brand as brandApi } from '@/lib/api';
import type { Platform } from '@/lib/platform-config';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';
import { useContentViewStore } from '@/stores/contentViewStore';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { SocialAccountAvatar } from '@/components/social/SocialAccountAvatar';

const PLATFORM_SET: ReadonlySet<string> = new Set([
  'instagram',
  'facebook',
  'linkedin',
  'x',
  'youtube',
  'tiktok',
]);

type SocialAccountOption = {
  id: string;
  platform: Platform;
  label: string;
  avatarName: string;
  avatarUrl: string | null;
  disconnected: boolean;
  sortOrder: number;
};

function toSocialAccountOptions(raw: unknown): SocialAccountOption[] {
  const list = (raw as any)?.socialAccounts;
  const accounts = Array.isArray(list) ? (list as any[]) : [];

  return accounts
    .map((account) => {
      const id = typeof account?.id === 'string' ? account.id : null;
      const platformRaw = typeof account?.platform === 'string' ? account.platform : null;
      if (!id || !platformRaw || !PLATFORM_SET.has(platformRaw)) return null;
      const platform = platformRaw as Platform;

      const username = typeof account?.username === 'string' ? account.username : null;
      const displayName = typeof account?.displayName === 'string' ? account.displayName : null;
      const label = username ? `@${username}` : displayName || platform;
      const avatarName = username || displayName || platform;
      const avatarUrl =
        typeof account?.profilePictureUrl === 'string' ? account.profilePictureUrl : null;
      const disconnected = account?.disconnected === true;
      const sortOrder = typeof account?.sortOrder === 'number' ? account.sortOrder : 0;

      return { id, platform, label, avatarName, avatarUrl, disconnected, sortOrder };
    })
    .filter((a): a is SocialAccountOption => Boolean(a))
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.label.localeCompare(b.label);
    });
}

export function ContentViewSelector({ brandId }: { brandId: string }) {
  const [open, setOpen] = useState(false);
  const storeEntry = useContentViewStore((s) => s.selectedSocialAccountIdsByBrandId[brandId]);
  const setSelectedSocialAccountIds = useContentViewStore((s) => s.setSelectedSocialAccountIds);

  const accountsQuery = useQuery({
    queryKey: ['brand-social-accounts', brandId],
    queryFn: () => brandApi.getConnectedAccounts(brandId),
    enabled: Boolean(brandId),
    staleTime: CACHE_TIMES.LONG,
    gcTime: GC_TIMES.LONG,
    refetchOnWindowFocus: false,
  });

  const primarySocialAccountId = useMemo(() => {
    const raw = accountsQuery.data as any;
    return typeof raw?.primarySocialAccountId === 'string' ? raw.primarySocialAccountId : null;
  }, [accountsQuery.data]);

  const options = useMemo(() => toSocialAccountOptions(accountsQuery.data), [accountsQuery.data]);

  const selectedSocialAccountIds = useMemo(() => {
    if (storeEntry === undefined) return undefined;
    if (storeEntry == null) return null;
    return storeEntry.filter((id) => typeof id === 'string' && id.trim().length > 0);
  }, [storeEntry]);

  useEffect(() => {
    if (!brandId) return;
    if (selectedSocialAccountIds !== undefined) return;
    if (accountsQuery.isLoading) return;

    const defaultId =
      (primarySocialAccountId && options.some((o) => o.id === primarySocialAccountId)
        ? primarySocialAccountId
        : options[0]?.id) ?? null;

    setSelectedSocialAccountIds(brandId, defaultId ? [defaultId] : null);
  }, [
    accountsQuery.isLoading,
    brandId,
    options,
    primarySocialAccountId,
    selectedSocialAccountIds,
    setSelectedSocialAccountIds,
  ]);

  const selectedOption = useMemo(() => {
    if (!Array.isArray(selectedSocialAccountIds) || selectedSocialAccountIds.length !== 1)
      return null;
    return options.find((o) => o.id === selectedSocialAccountIds[0]) || null;
  }, [options, selectedSocialAccountIds]);

  const selectedCount = Array.isArray(selectedSocialAccountIds)
    ? selectedSocialAccountIds.length
    : 0;
  const triggerLabel =
    selectedSocialAccountIds == null
      ? 'All destinations'
      : selectedCount <= 1
        ? (selectedOption?.label ?? 'Select destinations')
        : `${selectedCount} destinations`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-10 min-w-0 justify-between gap-2 px-3"
          disabled={accountsQuery.isLoading}
        >
          <span className="flex min-w-0 items-center gap-2">
            {accountsQuery.isLoading ? (
              <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" aria-hidden="true" />
            ) : selectedOption ? (
              <SocialAccountAvatar
                platform={selectedOption.platform}
                name={selectedOption.avatarName}
                src={selectedOption.avatarUrl}
                size="sm"
                selected
                muted={false}
                disabled={selectedOption.disconnected}
              />
            ) : (
              <span className="bg-muted text-muted-foreground flex h-8 w-8 items-center justify-center rounded-full">
                <Layers className="h-4 w-4" aria-hidden="true" />
              </span>
            )}
            <span className="min-w-0 truncate text-left text-sm">{triggerLabel}</span>
          </span>
          <ChevronsUpDown className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] p-0">
        <Command>
          <CommandInput placeholder="Search destinations..." />
          <CommandList>
            <CommandEmpty>
              {accountsQuery.isLoading ? 'Loading destinations...' : 'No destinations found.'}
            </CommandEmpty>

            <CommandGroup heading="Destinations">
              <CommandItem
                value="__all__"
                onSelect={() => {
                  setSelectedSocialAccountIds(brandId, null);
                  setOpen(false);
                }}
                className="flex items-center justify-between gap-3"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="bg-muted text-muted-foreground flex h-8 w-8 items-center justify-center rounded-full">
                    <Layers className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 truncate">All destinations</span>
                </div>
                <span
                  className={cn(
                    'text-muted-foreground',
                    selectedSocialAccountIds == null && 'opacity-100'
                  )}
                >
                  {selectedSocialAccountIds == null && (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  )}
                </span>
              </CommandItem>

              {options.length > 0 && <CommandSeparator />}

              {options.map((account) => {
                const isPrimary = Boolean(
                  primarySocialAccountId && account.id === primarySocialAccountId
                );
                const active = Array.isArray(selectedSocialAccountIds)
                  ? selectedSocialAccountIds.includes(account.id)
                  : false;
                return (
                  <CommandItem
                    key={account.id}
                    value={`${account.label} ${account.platform}`}
                    onSelect={() => {
                      const nextSet = new Set<string>(
                        Array.isArray(selectedSocialAccountIds) ? selectedSocialAccountIds : []
                      );
                      if (nextSet.has(account.id)) nextSet.delete(account.id);
                      else nextSet.add(account.id);
                      const next = Array.from(nextSet);
                      setSelectedSocialAccountIds(brandId, next.length ? next : null);
                    }}
                    className="flex items-center justify-between gap-3"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <SocialAccountAvatar
                        platform={account.platform}
                        name={account.avatarName}
                        src={account.avatarUrl}
                        size="sm"
                        selected={active}
                        muted={!active}
                        disabled={account.disconnected}
                      />
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate">{account.label}</span>
                        {isPrimary && <Badge variant="secondary">Primary</Badge>}
                      </div>
                    </div>
                    {active && <Check className="h-4 w-4" aria-hidden="true" />}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
