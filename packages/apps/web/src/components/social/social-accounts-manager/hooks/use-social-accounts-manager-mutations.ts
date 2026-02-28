import { useMutation, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { brand as brandApi } from '@/lib/api';

import type { ConnectedAccount } from '../types';

type UseSocialAccountsManagerMutationsParams = {
  brandId: string;
  queryClient: QueryClient;
  onAccountsChanged?: () => void;
  onDisconnectSuccess: () => void;
  onSyncMutate: (accountId: string) => void;
  onSyncSettled: () => void;
};

type SharedMutationParams = Pick<
  UseSocialAccountsManagerMutationsParams,
  'brandId' | 'queryClient' | 'onAccountsChanged'
>;

function getBrandSocialAccountsQueryKey(brandId: string) {
  return ['brand-social-accounts', brandId];
}

function getSyncDescription(skipped: number, failed: number): string | undefined {
  if (skipped <= 0 && failed <= 0) {
    return undefined;
  }

  const skippedLabel = skipped > 0 ? `${skipped} skipped` : '';
  const failedLabel = failed > 0 ? `${failed} failed` : '';

  return [skippedLabel, failedLabel].filter(Boolean).join(', ');
}

function showSyncResultToast(data: any) {
  const synced = Number(data?.results?.synced || 0);
  const skipped = Number(data?.results?.skipped || 0);

  if (synced > 0) {
    toast.success(`Synced ${synced} posts`, {
      description: getSyncDescription(skipped, Number(data?.results?.failed || 0)),
    });
    return;
  }

  if (skipped > 0) {
    toast.info('No new posts to sync', { description: `${skipped} already imported` });
    return;
  }

  toast.info('No posts found to sync');
}

function useDefaultAccountsMutation({
  brandId,
  queryClient,
  onAccountsChanged,
}: SharedMutationParams) {
  const queryKey = getBrandSocialAccountsQueryKey(brandId);

  return useMutation({
    mutationFn: async (socialAccountIds: string[]) =>
      brandApi.setDefaultPostSocialAccounts(brandId, socialAccountIds),
    onMutate: async (socialAccountIds) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);

      queryClient.setQueryData(queryKey, (old: any) => {
        if (!old || typeof old !== 'object') {
          return old;
        }

        return { ...old, defaultPostSocialAccountIds: socialAccountIds };
      });

      return { previous };
    },
    onSuccess: () => {
      toast.success('Default accounts updated');
    },
    onError: (error: any, _ids, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(queryKey, ctx.previous);
      }

      toast.error('Failed to update defaults', {
        description: error?.message || 'Please try again',
      });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey });
      onAccountsChanged?.();
    },
  });
}

function useDisconnectMutation({
  brandId,
  queryClient,
  onAccountsChanged,
  onDisconnectSuccess,
}: SharedMutationParams & Pick<UseSocialAccountsManagerMutationsParams, 'onDisconnectSuccess'>) {
  const queryKey = getBrandSocialAccountsQueryKey(brandId);

  return useMutation({
    mutationFn: async (opts: { socialAccountId: string; removeImportedPosts: boolean }) =>
      brandApi.disconnectSocialAccount(brandId, opts.socialAccountId, {
        removeImportedPosts: opts.removeImportedPosts,
      }),
    onSuccess: async () => {
      onDisconnectSuccess();
      await queryClient.invalidateQueries({ queryKey });
      onAccountsChanged?.();
    },
  });
}

function useSyncPostsMutation({
  brandId,
  queryClient,
  onAccountsChanged,
  onSyncMutate,
  onSyncSettled,
}: SharedMutationParams &
  Pick<UseSocialAccountsManagerMutationsParams, 'onSyncMutate' | 'onSyncSettled'>) {
  return useMutation({
    mutationFn: async (account: ConnectedAccount) =>
      brandApi.syncSocialPosts(brandId, account.platform, {
        maxPosts: 100,
        maxDays: 30,
        socialAccountId: account.id,
      }),
    onMutate: (account) => {
      onSyncMutate(account.id);
    },
    onSuccess: async (data: any) => {
      showSyncResultToast(data);
      onSyncSettled();

      await queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
      await queryClient.invalidateQueries({ queryKey: ['content', brandId] });
      onAccountsChanged?.();
    },
    onError: (error: any) => {
      onSyncSettled();
      toast.error('Sync failed', { description: error?.message || 'Please try again' });
    },
  });
}

function useReorderAccountsMutation({
  brandId,
  queryClient,
  onAccountsChanged,
}: SharedMutationParams) {
  const queryKey = getBrandSocialAccountsQueryKey(brandId);

  return useMutation({
    mutationFn: async (orderedIds: string[]) => brandApi.setSocialAccountOrder(brandId, orderedIds),
    onMutate: async (orderedIds) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);

      queryClient.setQueryData(queryKey, (old: any) => {
        if (!old || typeof old !== 'object') {
          return old;
        }

        const accounts = Array.isArray(old.socialAccounts) ? old.socialAccounts.slice() : [];
        const orderIndex = new Map(orderedIds.map((id, idx) => [id, idx]));
        const nextAccounts = accounts.map((a: any) => {
          const idx = orderIndex.get(a?.id);
          return typeof idx === 'number' ? { ...a, sortOrder: idx } : a;
        });

        return {
          ...old,
          socialAccounts: nextAccounts,
          primarySocialAccountId: orderedIds[0] || null,
        };
      });

      return { previous };
    },
    onError: (error: any, _orderedIds, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(queryKey, ctx.previous);
      }

      toast.error('Failed to reorder accounts', {
        description: error?.message || 'Please try again',
      });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey });
      onAccountsChanged?.();
    },
  });
}

export function useSocialAccountsManagerMutations({
  brandId,
  queryClient,
  onAccountsChanged,
  onDisconnectSuccess,
  onSyncMutate,
  onSyncSettled,
}: UseSocialAccountsManagerMutationsParams) {
  const sharedParams = { brandId, queryClient, onAccountsChanged };

  const defaultAccountsMutation = useDefaultAccountsMutation(sharedParams);
  const disconnectMutation = useDisconnectMutation({
    ...sharedParams,
    onDisconnectSuccess,
  });
  const syncPostsMutation = useSyncPostsMutation({
    ...sharedParams,
    onSyncMutate,
    onSyncSettled,
  });
  const reorderAccountsMutation = useReorderAccountsMutation(sharedParams);

  return {
    defaultAccountsMutation,
    disconnectMutation,
    reorderAccountsMutation,
    syncPostsMutation,
  };
}
