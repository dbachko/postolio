import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { brand as brandApi } from '@/lib/api';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';
import { isMultiDestinationEnabled } from '@/lib/feature-flags';
import type { Platform } from '@/lib/platform-config';
import { formatSocialAccountLabel } from '@/lib/social-account-label';
import { useAuthStore } from '@/stores/authStore';
import { useContentViewStore } from '@/stores/contentViewStore';
import {
  ContentViewSelectorPopover,
  type SocialAccountOption,
} from './components/content-view-selector-popover';

const PLATFORM_SET: ReadonlySet<string> = new Set([
  'instagram',
  'facebook',
  'linkedin',
  'x',
  'youtube',
  'tiktok',
]);

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function resolvePlatform(platformRaw: string | null): Platform | null {
  if (!platformRaw || !PLATFORM_SET.has(platformRaw)) {
    return null;
  }
  return platformRaw as Platform;
}

function resolveAvatarName(
  username: string | null,
  displayName: string | null,
  platform: Platform
): string {
  if (username) {
    return username;
  }
  if (displayName) {
    return displayName;
  }
  return platform;
}

function resolveSortOrder(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function toSocialAccountOption(account: any): SocialAccountOption | null {
  const id = readString(account?.id);
  const platform = resolvePlatform(readString(account?.platform));
  if (!id || !platform) {
    return null;
  }
  const username = readString(account?.username);
  const displayName = readString(account?.displayName);

  return {
    id,
    platform,
    label: formatSocialAccountLabel({ platform, username, displayName }),
    avatarName: resolveAvatarName(username, displayName, platform),
    avatarUrl: readString(account?.profilePictureUrl),
    disconnected: account?.disconnected === true,
    sortOrder: resolveSortOrder(account?.sortOrder),
  };
}

function compareSocialAccountOptions(
  left: SocialAccountOption,
  right: SocialAccountOption
): number {
  if (left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder;
  }
  return left.label.localeCompare(right.label);
}

function toSocialAccountOptions(raw: unknown): SocialAccountOption[] {
  const list = (raw as any)?.socialAccounts;
  const accounts = Array.isArray(list) ? (list as any[]) : [];

  return accounts
    .map((account) => toSocialAccountOption(account))
    .filter((account): account is SocialAccountOption => Boolean(account))
    .sort(compareSocialAccountOptions);
}

function usePrimaryAndOptions(data: unknown) {
  const primarySocialAccountId = useMemo(() => {
    const raw = data as any;
    return typeof raw?.primarySocialAccountId === 'string' ? raw.primarySocialAccountId : null;
  }, [data]);

  const options = useMemo(() => toSocialAccountOptions(data), [data]);

  return { primarySocialAccountId, options };
}

function useSelectedSocialAccountIds(storeEntry: string[] | null | undefined) {
  return useMemo(() => {
    if (storeEntry === undefined) {
      return undefined;
    }
    if (storeEntry == null) {
      return null;
    }
    return storeEntry.filter((id) => typeof id === 'string' && id.trim().length > 0);
  }, [storeEntry]);
}

function useSyncDefaultSelection({
  brandId,
  isLoading,
  options,
  primarySocialAccountId,
  selectedSocialAccountIds,
  setSelectedSocialAccountIds,
  multiDestinationEnabled,
}: {
  brandId: string;
  isLoading: boolean;
  options: SocialAccountOption[];
  primarySocialAccountId: string | null;
  selectedSocialAccountIds: string[] | null | undefined;
  setSelectedSocialAccountIds: (brandId: string, socialAccountIds: string[] | null) => void;
  multiDestinationEnabled: boolean;
}) {
  useEffect(() => {
    if (!brandId || isLoading) {
      return;
    }

    const defaultId =
      (primarySocialAccountId && options.some((option) => option.id === primarySocialAccountId)
        ? primarySocialAccountId
        : options[0]?.id) ?? null;

    if (!multiDestinationEnabled) {
      const currentSingleId =
        Array.isArray(selectedSocialAccountIds) && selectedSocialAccountIds.length === 1
          ? selectedSocialAccountIds[0]
          : null;
      if (currentSingleId !== defaultId || selectedSocialAccountIds == null) {
        setSelectedSocialAccountIds(brandId, defaultId ? [defaultId] : null);
      }
      return;
    }

    if (selectedSocialAccountIds === undefined) {
      setSelectedSocialAccountIds(brandId, defaultId ? [defaultId] : null);
    }
  }, [
    brandId,
    isLoading,
    multiDestinationEnabled,
    options,
    primarySocialAccountId,
    selectedSocialAccountIds,
    setSelectedSocialAccountIds,
  ]);
}

function getTriggerLabel({
  selectedSocialAccountIds,
  selectedOption,
}: {
  selectedSocialAccountIds: string[] | null;
  selectedOption: SocialAccountOption | null;
}) {
  if (selectedSocialAccountIds == null) {
    return 'All destinations';
  }
  if (selectedSocialAccountIds.length <= 1) {
    return selectedOption?.label ?? 'Select destinations';
  }
  return `${selectedSocialAccountIds.length} destinations`;
}

function useContentViewSelectorModel({
  brandId,
  multiDestinationEnabled,
}: {
  brandId: string;
  multiDestinationEnabled: boolean;
}) {
  const storeEntry = useContentViewStore(
    (state) => state.selectedSocialAccountIdsByBrandId[brandId]
  );
  const setSelectedSocialAccountIds = useContentViewStore(
    (state) => state.setSelectedSocialAccountIds
  );

  const accountsQuery = useQuery({
    queryKey: ['brand-social-accounts', brandId],
    queryFn: () => brandApi.getConnectedAccounts(brandId),
    enabled: Boolean(brandId),
    staleTime: CACHE_TIMES.LONG,
    gcTime: GC_TIMES.LONG,
    refetchOnWindowFocus: false,
  });

  const { primarySocialAccountId, options } = usePrimaryAndOptions(accountsQuery.data);
  const selectedSocialAccountIds = useSelectedSocialAccountIds(storeEntry);

  useSyncDefaultSelection({
    brandId,
    isLoading: accountsQuery.isLoading,
    options,
    primarySocialAccountId,
    selectedSocialAccountIds,
    setSelectedSocialAccountIds,
    multiDestinationEnabled,
  });

  const selectedOption = useMemo(() => {
    if (!Array.isArray(selectedSocialAccountIds) || selectedSocialAccountIds.length !== 1) {
      return null;
    }
    return options.find((option) => option.id === selectedSocialAccountIds[0]) || null;
  }, [options, selectedSocialAccountIds]);

  const triggerLabel = useMemo(
    () =>
      getTriggerLabel({
        selectedSocialAccountIds: selectedSocialAccountIds ?? null,
        selectedOption,
      }),
    [selectedOption, selectedSocialAccountIds]
  );

  const selectAll = useCallback(() => {
    setSelectedSocialAccountIds(brandId, null);
  }, [brandId, setSelectedSocialAccountIds]);

  const toggleAccount = useCallback(
    (accountId: string) => {
      const next = new Set(Array.isArray(selectedSocialAccountIds) ? selectedSocialAccountIds : []);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      const nextValues = Array.from(next);
      setSelectedSocialAccountIds(brandId, nextValues.length > 0 ? nextValues : null);
    },
    [brandId, selectedSocialAccountIds, setSelectedSocialAccountIds]
  );

  return {
    isLoading: accountsQuery.isLoading,
    primarySocialAccountId,
    options,
    selectedSocialAccountIds,
    selectedOption,
    triggerLabel,
    selectAll,
    toggleAccount,
  };
}

export function ContentViewSelector({ brandId }: { brandId: string }) {
  const [open, setOpen] = useState(false);
  const user = useAuthStore((state) => state.user);
  const multiDestinationEnabled = isMultiDestinationEnabled(user);

  const model = useContentViewSelectorModel({ brandId, multiDestinationEnabled });
  if (!multiDestinationEnabled) {
    return null;
  }

  return (
    <ContentViewSelectorPopover
      open={open}
      onOpenChange={setOpen}
      isLoading={model.isLoading}
      triggerLabel={model.triggerLabel}
      selectedOption={model.selectedOption}
      selectedSocialAccountIds={model.selectedSocialAccountIds ?? null}
      options={model.options}
      primarySocialAccountId={model.primarySocialAccountId}
      onSelectAll={() => {
        model.selectAll();
        setOpen(false);
      }}
      onToggleAccount={model.toggleAccount}
    />
  );
}
