import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { brand as brandApi } from '@/lib/api';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';
import type { Platform } from '@/lib/platform-config';
import { formatSocialAccountLabel } from '@/lib/social-account-label';
import type { SocialAccountsById } from '@/types/social-accounts';

interface UseFullCalendarSocialAccountsDataParams {
  brandId: string;
  multiDestinationEnabled: boolean;
  targetSocialAccountIds: string[] | null;
}

interface RawSocialAccount {
  id?: unknown;
  platform?: unknown;
  username?: unknown;
  displayName?: unknown;
  profilePictureUrl?: unknown;
  disconnected?: unknown;
}

function getRawSocialAccounts(data: unknown): RawSocialAccount[] {
  const raw = (data as { socialAccounts?: unknown } | undefined)?.socialAccounts;
  return Array.isArray(raw) ? (raw as RawSocialAccount[]) : [];
}

function resolveFallbackSingleDestinationId(
  rawSocialAccounts: RawSocialAccount[],
  data: unknown
): string | null {
  const connectedAccounts = rawSocialAccounts.filter(
    (account): account is RawSocialAccount & { id: string } =>
      account?.disconnected !== true && typeof account?.id === 'string'
  );
  if (!connectedAccounts.length) {
    return null;
  }

  const primaryRaw = (data as { primarySocialAccountId?: unknown } | undefined)
    ?.primarySocialAccountId;
  const primaryId = typeof primaryRaw === 'string' ? primaryRaw : null;
  if (primaryId && connectedAccounts.some((account) => account.id === primaryId)) {
    return primaryId;
  }

  return connectedAccounts[0]?.id ?? null;
}

function resolveEffectiveSingleDestinationId(
  targetSocialAccountIds: string[] | null,
  multiDestinationEnabled: boolean,
  fallbackSingleDestinationId: string | null
): string | null {
  if (Array.isArray(targetSocialAccountIds) && targetSocialAccountIds.length === 1) {
    const id = targetSocialAccountIds[0];
    return typeof id === 'string' && id.trim().length > 0 ? id.trim() : null;
  }
  if (!multiDestinationEnabled) {
    return fallbackSingleDestinationId;
  }
  return null;
}

function readStringField(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function toSocialAccountEntry(
  account: RawSocialAccount
): [string, SocialAccountsById[string]] | null {
  const id = readStringField(account?.id);
  const platformValue = readStringField(account?.platform);
  const platform = platformValue ? (platformValue as Platform) : null;
  if (!id || !platform) {
    return null;
  }

  const username = readStringField(account?.username);
  const displayName = readStringField(account?.displayName);
  return [
    id,
    {
      platform,
      label: formatSocialAccountLabel({ platform, username, displayName }),
      avatarName: username || displayName || platform,
      avatarUrl: typeof account?.profilePictureUrl === 'string' ? account.profilePictureUrl : null,
      disconnected: account?.disconnected === true,
    },
  ];
}

function buildSocialAccountsById(rawSocialAccounts: RawSocialAccount[]): SocialAccountsById {
  const out: SocialAccountsById = {};
  for (const account of rawSocialAccounts) {
    const entry = toSocialAccountEntry(account);
    if (!entry) {
      continue;
    }
    const [id, value] = entry;
    out[id] = value;
  }
  return out;
}

export function useFullCalendarSocialAccountsData({
  brandId,
  multiDestinationEnabled,
  targetSocialAccountIds,
}: UseFullCalendarSocialAccountsDataParams) {
  const socialAccountsQuery = useQuery({
    queryKey: ['brand-social-accounts', brandId],
    queryFn: () => brandApi.getConnectedAccounts(brandId),
    enabled: Boolean(brandId),
    staleTime: CACHE_TIMES.LONG,
    gcTime: GC_TIMES.LONG,
    refetchOnWindowFocus: false,
  });

  const rawSocialAccounts = useMemo(
    () => getRawSocialAccounts(socialAccountsQuery.data),
    [socialAccountsQuery.data]
  );
  const fallbackSingleDestinationId = useMemo(
    () => resolveFallbackSingleDestinationId(rawSocialAccounts, socialAccountsQuery.data),
    [rawSocialAccounts, socialAccountsQuery.data]
  );
  const effectiveSingleDestinationId = useMemo(
    () =>
      resolveEffectiveSingleDestinationId(
        targetSocialAccountIds,
        multiDestinationEnabled,
        fallbackSingleDestinationId
      ),
    [targetSocialAccountIds, multiDestinationEnabled, fallbackSingleDestinationId]
  );
  const socialAccountsById = useMemo(
    () => buildSocialAccountsById(rawSocialAccounts),
    [rawSocialAccounts]
  );

  return { effectiveSingleDestinationId, socialAccountsById };
}
