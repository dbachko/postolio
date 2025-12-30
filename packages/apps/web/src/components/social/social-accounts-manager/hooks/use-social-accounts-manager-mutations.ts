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

export function useSocialAccountsManagerMutations({
  brandId,
  queryClient,
  onAccountsChanged,
  onDisconnectSuccess,
  onSyncMutate,
  onSyncSettled,
}: UseSocialAccountsManagerMutationsParams) {
  const defaultAccountsMutation = useMutation({
    mutationFn: async (socialAccountIds: string[]) => {
      return brandApi.setDefaultPostSocialAccounts(brandId, socialAccountIds);
    },
    onMutate: async (socialAccountIds) => {
      await queryClient.cancelQueries({ queryKey: ['brand-social-accounts', brandId] });
      const previous = queryClient.getQueryData(['brand-social-accounts', brandId]);
      queryClient.setQueryData(['brand-social-accounts', brandId], (old: any) => {
        if (!old || typeof old !== 'object') return old;
        return { ...old, defaultPostSocialAccountIds: socialAccountIds };
      });
      return { previous };
    },
    onSuccess: () => {
      toast.success('Default accounts updated');
    },
    onError: (error: any, _ids, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(['brand-social-accounts', brandId], ctx.previous);
      }
      toast.error('Failed to update defaults', {
        description: error?.message || 'Please try again',
      });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['brand-social-accounts', brandId] });
      onAccountsChanged?.();
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async (opts: { socialAccountId: string; removeImportedPosts: boolean }) => {
      return brandApi.disconnectSocialAccount(brandId, opts.socialAccountId, {
        removeImportedPosts: opts.removeImportedPosts,
      });
    },
    onSuccess: async () => {
      onDisconnectSuccess();
      await queryClient.invalidateQueries({ queryKey: ['brand-social-accounts', brandId] });
      onAccountsChanged?.();
    },
  });

  const syncPostsMutation = useMutation({
    mutationFn: async (account: ConnectedAccount) => {
      return brandApi.syncSocialPosts(brandId, account.platform, {
        maxPosts: 100,
        maxDays: 30,
        socialAccountId: account.id,
      });
    },
    onMutate: (account) => {
      onSyncMutate(account.id);
    },
    onSuccess: async (data: any) => {
      const synced = Number(data?.results?.synced || 0);
      const skipped = Number(data?.results?.skipped || 0);
      const failed = Number(data?.results?.failed || 0);

      if (synced > 0) {
        toast.success(`Synced ${synced} posts`, {
          description:
            skipped > 0 || failed > 0
              ? `${skipped > 0 ? `${skipped} skipped` : ''}${skipped > 0 && failed > 0 ? ', ' : ''}${failed > 0 ? `${failed} failed` : ''}`
              : undefined,
        });
      } else if (skipped > 0) {
        toast.info('No new posts to sync', { description: `${skipped} already imported` });
      } else {
        toast.info('No posts found to sync');
      }

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

  const reorderAccountsMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => brandApi.setSocialAccountOrder(brandId, orderedIds),
    onMutate: async (orderedIds) => {
      await queryClient.cancelQueries({ queryKey: ['brand-social-accounts', brandId] });
      const previous = queryClient.getQueryData(['brand-social-accounts', brandId]);
      queryClient.setQueryData(['brand-social-accounts', brandId], (old: any) => {
        if (!old || typeof old !== 'object') return old;
        const accounts = Array.isArray(old.socialAccounts) ? old.socialAccounts.slice() : [];
        const orderIndex = new Map(orderedIds.map((id, idx) => [id, idx]));
        const nextAccounts = accounts.map((a: any) => {
          const idx = orderIndex.get(a?.id);
          if (typeof idx !== 'number') return a;
          return { ...a, sortOrder: idx };
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
      if (ctx?.previous) queryClient.setQueryData(['brand-social-accounts', brandId], ctx.previous);
      toast.error('Failed to reorder accounts', {
        description: error?.message || 'Please try again',
      });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['brand-social-accounts', brandId] });
      onAccountsChanged?.();
    },
  });

  return {
    defaultAccountsMutation,
    disconnectMutation,
    reorderAccountsMutation,
    syncPostsMutation,
  };
}
