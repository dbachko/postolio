import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { brand as brandApi } from '@/lib/api';
import { getPlatformConfig, type Platform } from '@/lib/platform-config';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';
import { formatSocialAccountLabel } from '@/lib/social-account-label';

import type { ConnectedAccount } from '../types';
import { getConnectedAccountsFromQueryData } from '../utils';

type UseSocialAccountsManagerAccountsParams = {
  brandId: string;
};

function useConnectedAccounts(data: unknown) {
  const socialAccounts = useMemo(() => getConnectedAccountsFromQueryData(data), [data]);

  const connectedAccounts = useMemo(
    () =>
      socialAccounts
        .filter((a) => !a.disconnected)
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt)),
    [socialAccounts]
  );

  return { socialAccounts, connectedAccounts };
}

function usePrimarySocialAccountId(data: unknown, orderedConnectedIds: string[]) {
  return useMemo(() => {
    const raw = (data as any)?.primarySocialAccountId;
    return typeof raw === 'string' && raw.trim() ? raw : (orderedConnectedIds[0] ?? null);
  }, [data, orderedConnectedIds]);
}

function useDefaultPostSocialAccountIds(data: unknown, connectedAccounts: ConnectedAccount[]) {
  return useMemo(() => {
    const raw = (data as any)?.defaultPostSocialAccountIds;
    if (!Array.isArray(raw)) {
      return [] as string[];
    }

    const allowed = new Set(connectedAccounts.map((account) => account.id));
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of raw) {
      if (typeof value !== 'string') {
        continue;
      }
      const id = value.trim();
      if (!id || !allowed.has(id) || seen.has(id)) {
        continue;
      }
      seen.add(id);
      out.push(id);
    }
    return out;
  }, [data, connectedAccounts]);
}

function useDefaultPostSocialAccountOptions(connectedAccounts: ConnectedAccount[]) {
  return useMemo(() => {
    return connectedAccounts
      .map((account) => {
        const platform = account.platform as Platform;
        const platformConfig = getPlatformConfig(platform);
        const shortLabel = formatSocialAccountLabel({
          platform,
          username: account.username ?? null,
          displayName: account.displayName ?? null,
        });
        const avatarName =
          account.displayName ||
          account.username ||
          account.externalAccountId ||
          platformConfig.displayName;
        const tooltipLabel = shortLabel
          ? `${platformConfig.displayName} · ${shortLabel}`
          : platformConfig.displayName;

        return {
          id: account.id,
          platform,
          label: shortLabel,
          tooltipLabel,
          avatarName,
          avatarUrl: account.profilePictureUrl || null,
          disabled: false,
        };
      })
      .sort((a, b) => a.platform.localeCompare(b.platform) || a.id.localeCompare(b.id));
  }, [connectedAccounts]);
}

function useOrderedAccounts(connectedAccounts: ConnectedAccount[], orderedConnectedIds: string[]) {
  return useMemo(() => {
    const byId = new Map(connectedAccounts.map((account) => [account.id, account]));
    return orderedConnectedIds.map((id) => byId.get(id)).filter(Boolean) as ConnectedAccount[];
  }, [connectedAccounts, orderedConnectedIds]);
}

export function useSocialAccountsManagerAccounts({
  brandId,
}: UseSocialAccountsManagerAccountsParams) {
  const [orderedConnectedIds, setOrderedConnectedIds] = useState<string[]>([]);

  const accountsQuery = useQuery({
    queryKey: ['brand-social-accounts', brandId],
    queryFn: () => brandApi.getConnectedAccounts(brandId),
    staleTime: CACHE_TIMES.LONG,
    gcTime: GC_TIMES.LONG,
    refetchOnWindowFocus: false,
  });

  const { socialAccounts, connectedAccounts } = useConnectedAccounts(accountsQuery.data);

  useEffect(() => {
    setOrderedConnectedIds(connectedAccounts.map((a) => a.id));
  }, [connectedAccounts]);

  const primarySocialAccountId = usePrimarySocialAccountId(accountsQuery.data, orderedConnectedIds);
  const defaultPostSocialAccountIds = useDefaultPostSocialAccountIds(
    accountsQuery.data,
    connectedAccounts
  );
  const defaultPostSocialAccountOptions = useDefaultPostSocialAccountOptions(connectedAccounts);
  const orderedAccounts = useOrderedAccounts(connectedAccounts, orderedConnectedIds);

  return {
    accountsQuery,
    connectedAccounts,
    defaultPostSocialAccountIds,
    defaultPostSocialAccountOptions,
    orderedAccounts,
    orderedConnectedIds,
    primarySocialAccountId,
    socialAccounts,
    setOrderedConnectedIds,
  };
}
