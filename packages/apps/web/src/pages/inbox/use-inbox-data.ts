import {
  useEffect,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { brand as brandApi, savedReplies } from '@/lib/api';
import { useAssetsByIds } from '@/features/assets/hooks/useAssetsByIds';

import { getInboxItemKey, matchesQuery, parseInboxItemKey } from './inbox-utils';
import type { InboxUiState } from './use-inbox-ui-state';
import type { ConnectedAccount, InboxChannelFilter, InboxItem, InboxPlatformFilter } from './types';

export function useConnectedAccounts(
  brandId: string | undefined,
  selectedAccountId: string,
  setState: Dispatch<SetStateAction<InboxUiState>>
) {
  const { data: connectedAccountsData } = useQuery({
    queryKey: ['connected-accounts', brandId],
    queryFn: async () => (await brandApi.getConnectedAccounts(brandId!)) as any,
    enabled: Boolean(brandId),
    staleTime: 30_000,
  });

  const socialAccounts = useMemo(() => {
    const accounts = (connectedAccountsData as any)?.socialAccounts || [];
    return (accounts as any[]).slice().sort((a, b) => {
      const aDisconnected = Boolean(a?.disconnected);
      const bDisconnected = Boolean(b?.disconnected);
      if (aDisconnected !== bDisconnected) {
        return aDisconnected ? 1 : -1;
      }

      const aOrder = typeof a?.sortOrder === 'number' ? a.sortOrder : 0;
      const bOrder = typeof b?.sortOrder === 'number' ? b.sortOrder : 0;
      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }

      return String(a?.createdAt || '').localeCompare(String(b?.createdAt || ''));
    }) as ConnectedAccount[];
  }, [connectedAccountsData]);

  useEffect(() => {
    if (!brandId || selectedAccountId || socialAccounts.length === 0) {
      return;
    }

    const firstConnected = socialAccounts.find((account) => !account?.disconnected);
    const defaultAccount = firstConnected || socialAccounts[0];
    setState((prev) => ({ ...prev, selectedAccountId: String(defaultAccount.id) }));
  }, [brandId, selectedAccountId, setState, socialAccounts]);

  const socialAccountById = useMemo(
    () => new Map(socialAccounts.map((account) => [String(account.id), account])),
    [socialAccounts]
  );

  return { socialAccounts, socialAccountById };
}

export function useInboxItems(brandId: string | undefined) {
  const inboxQueryKey = useMemo(() => ['inbox-items', brandId] as const, [brandId]);

  const {
    data: inboxData,
    isLoading: inboxLoading,
    isError: inboxIsError,
    error: inboxError,
    refetch: refetchInbox,
  } = useQuery({
    queryKey: inboxQueryKey,
    queryFn: async () =>
      (await brandApi.getInboxItems(brandId!, {
        view: 'all',
        limit: 200,
      })) as any,
    enabled: Boolean(brandId),
    staleTime: 10_000,
  });

  const items = useMemo(() => ((inboxData as any)?.items || []) as InboxItem[], [inboxData]);

  return {
    items,
    inboxLoading,
    inboxIsError,
    inboxError,
    refetchInbox,
  };
}

export function useSyncInboxMutation({
  brandId,
  refetchInbox,
  autoSyncedAccountsRef,
}: {
  brandId: string | undefined;
  refetchInbox: () => Promise<unknown>;
  autoSyncedAccountsRef: MutableRefObject<Set<string>>;
}) {
  return useMutation({
    mutationFn: async (vars: { socialAccountId: string; silent?: boolean }) => {
      if (!brandId) {
        throw new Error('No brand selected');
      }
      const socialAccountId = String(vars.socialAccountId || '').trim();
      if (!socialAccountId) {
        throw new Error('No social account selected');
      }

      const [commentsRes, dmsRes] = await Promise.allSettled([
        brandApi.ingestInboxComments(brandId, {
          socialAccountIds: [socialAccountId],
          sync: true,
          maxPosts: 20,
          perPostLimit: 50,
        }),
        brandApi.ingestInboxDMs(brandId, {
          socialAccountIds: [socialAccountId],
          sync: true,
          maxThreads: 25,
          perThreadLimit: 30,
        }),
      ]);

      const commentsOk = commentsRes.status === 'fulfilled';
      const dmsOk = dmsRes.status === 'fulfilled';
      if (!commentsOk && !dmsOk) {
        const error = commentsRes.status === 'rejected' ? commentsRes.reason : dmsRes.reason;
        throw error instanceof Error ? error : new Error('Failed to sync inbox');
      }

      return { commentsOk, dmsOk };
    },
    onSuccess: async (data, vars) => {
      await refetchInbox();
      if (vars.silent) {
        return;
      }

      if (data.commentsOk && data.dmsOk) {
        toast.success('Inbox synced');
        return;
      }
      if (data.commentsOk) {
        toast.info('Synced comments. DMs may need additional permissions.');
        return;
      }
      toast.info('Synced DMs. Comments may need additional permissions.');
    },
    onError: (error: any, vars) => {
      autoSyncedAccountsRef.current.delete(String(vars?.socialAccountId || ''));
      if (!vars?.silent) {
        toast.error(error?.message || 'Failed to sync inbox');
      }
    },
  });
}

export function useAutoSyncInbox({
  brandId,
  selectedAccountId,
  syncInboxMutation,
  autoSyncedAccountsRef,
}: {
  brandId: string | undefined;
  selectedAccountId: string;
  syncInboxMutation: ReturnType<typeof useSyncInboxMutation>;
  autoSyncedAccountsRef: MutableRefObject<Set<string>>;
}) {
  useEffect(() => {
    if (!brandId || !selectedAccountId) {
      return;
    }
    if (autoSyncedAccountsRef.current.has(selectedAccountId)) {
      return;
    }

    autoSyncedAccountsRef.current.add(selectedAccountId);
    syncInboxMutation.mutate({ socialAccountId: selectedAccountId, silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, selectedAccountId]);
}

export function useFilteredInboxItems({
  items,
  channel,
  platform,
  selectedAccountId,
  itemQuery,
}: {
  items: InboxItem[];
  channel: InboxChannelFilter;
  platform: InboxPlatformFilter;
  selectedAccountId: string;
  itemQuery: string;
}) {
  const scopedItems = useMemo(() => {
    let next = items;
    if (channel === 'comments') {
      next = next.filter((item) => item.type === 'comment_thread');
    }
    if (channel === 'dms') {
      next = next.filter((item) => item.type === 'dm_conversation');
    }
    if (platform !== 'all') {
      next = next.filter((item) => item.platform === platform);
    }
    return next;
  }, [channel, items, platform]);

  const filteredItems = useMemo(() => {
    let next = scopedItems;
    if (selectedAccountId) {
      next = next.filter((item) => item.socialAccountId === selectedAccountId);
    }

    const query = itemQuery.trim().toLowerCase();
    if (!query) {
      return next;
    }

    return next.filter((item) => {
      if (item.type === 'dm_conversation') {
        return (
          matchesQuery(item.participantUsername || '', query) ||
          matchesQuery(item.lastMessageText || '', query)
        );
      }

      return (
        matchesQuery(item.previewAuthorUsername ? `@${item.previewAuthorUsername}` : '', query) ||
        matchesQuery(item.previewText || '', query) ||
        matchesQuery(item.caption || '', query)
      );
    });
  }, [itemQuery, scopedItems, selectedAccountId]);

  const itemCountBySocialAccountId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of scopedItems) {
      const previousCount = counts.get(item.socialAccountId) || 0;
      counts.set(item.socialAccountId, previousCount + 1);
    }
    return counts;
  }, [scopedItems]);

  return { filteredItems, itemCountBySocialAccountId };
}

export function useSelectedInboxItem(
  filteredItems: InboxItem[],
  selectedItemKey: string | null,
  setState: Dispatch<SetStateAction<InboxUiState>>
) {
  useEffect(() => {
    if (filteredItems.length === 0) {
      setState((prev) => ({ ...prev, selectedItemKey: null }));
      return;
    }

    if (!selectedItemKey) {
      setState((prev) => ({ ...prev, selectedItemKey: getInboxItemKey(filteredItems[0]) }));
      return;
    }

    const stillExists = filteredItems.some((item) => getInboxItemKey(item) === selectedItemKey);
    if (!stillExists) {
      setState((prev) => ({ ...prev, selectedItemKey: getInboxItemKey(filteredItems[0]) }));
    }
  }, [filteredItems, selectedItemKey, setState]);

  return useMemo(() => {
    if (!selectedItemKey) {
      return null;
    }

    const parsed = parseInboxItemKey(selectedItemKey);
    if (!parsed) {
      return null;
    }

    if (parsed.kind === 'dm') {
      return (
        filteredItems.find(
          (item) => item.type === 'dm_conversation' && item.conversationId === parsed.id
        ) || null
      );
    }

    return (
      filteredItems.find(
        (item) => item.type === 'comment_thread' && item.publicationId === parsed.id
      ) || null
    );
  }, [filteredItems, selectedItemKey]);
}

export function useSelectedCommentPreview(selectedItem: InboxItem | null) {
  const selectedAssetId =
    selectedItem?.type === 'comment_thread' ? selectedItem.primaryAssetId : null;
  const { data: selectedAssetsById } = useAssetsByIds([selectedAssetId]);

  const selectedPreviewUrl = useMemo(() => {
    if (!selectedAssetId) {
      return null;
    }

    const asset = selectedAssetsById?.[selectedAssetId] ?? null;
    return asset?.thumbnailUrl || asset?.url || null;
  }, [selectedAssetId, selectedAssetsById]);

  return { selectedPreviewUrl };
}

export function useSavedReplies(brandId: string | undefined) {
  return useQuery<{
    savedReplies: Array<{ id: string; title: string; body: string }>;
  }>({
    queryKey: ['saved-replies', brandId],
    queryFn: async () => (await savedReplies.listSavedReplies(brandId!)) as any,
    enabled: Boolean(brandId),
  });
}
