import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { brand as brandApi } from '@/lib/api';
import { CACHE_TIMES, REFETCH_INTERVALS } from '@/lib/cache-config';
import { getPlatformConfig, type Platform } from '@/lib/platform-config';

interface SyncResponse {
  success: boolean;
  results: {
    synced: number;
    skipped: number;
    failed: number;
    errors?: string[];
  };
  message: string;
}

interface SyncStatus {
  inProgress: boolean;
  lockTtl?: number | null;
  cooldownRemaining?: number;
}

function useSocialSyncStatus(brandId: string, platform: Platform) {
  const [cooldownEndsAt, setCooldownEndsAt] = useState<number | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  const query = useQuery<SyncStatus>({
    queryKey: ['social-sync-status', brandId, platform],
    queryFn: async () => brandApi.getSocialSyncStatus(brandId, platform),
    staleTime: CACHE_TIMES.STATIC,
    refetchOnWindowFocus: false,
    refetchInterval: (q) => {
      const data = q.state.data as SyncStatus | undefined;
      return data?.inProgress ? REFETCH_INTERVALS.FAST : false;
    },
  });

  useEffect(() => {
    const remaining = query.data?.cooldownRemaining;
    if (typeof remaining === 'number' && remaining > 0) {
      setCooldownEndsAt(Date.now() + remaining * 1000);
      return;
    }

    setCooldownEndsAt(null);
    setCooldownSeconds(0);
  }, [query.data?.cooldownRemaining]);

  useEffect(() => {
    if (!cooldownEndsAt) {
      setCooldownSeconds(0);
      return;
    }

    const update = () => {
      const diff = Math.max(0, Math.ceil((cooldownEndsAt - Date.now()) / 1000));
      setCooldownSeconds(diff);
      if (diff <= 0) {
        setCooldownEndsAt(null);
      }
    };

    update();
    const intervalId = window.setInterval(update, 1000);
    return () => window.clearInterval(intervalId);
  }, [cooldownEndsAt]);

  return {
    statusData: query.data,
    statusFetching: query.isFetching,
    refetchStatus: query.refetch,
    cooldownSeconds,
  };
}

function buildSyncDescription(skipped: number, failed: number): string {
  if (skipped <= 0 && failed <= 0) {
    return 'Your posts are now available in the Timeline and Calendar';
  }

  const skippedText = skipped > 0 ? `${skipped} skipped` : '';
  const failedText = failed > 0 ? `${failed} failed` : '';
  return `${skippedText}${skippedText && failedText ? ', ' : ''}${failedText}`;
}

function useSocialSyncMutation(params: {
  brandId: string;
  platform: Platform;
  refetchStatus: () => Promise<unknown>;
}) {
  const [syncProgress, setSyncProgress] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const config = getPlatformConfig(params.platform);

  const mutation = useMutation<SyncResponse, Error>({
    mutationFn: async () => {
      setSyncProgress('Starting sync...');
      return brandApi.syncSocialPosts(params.brandId, params.platform, {
        maxPosts: 100,
        maxDays: 30,
      });
    },
    onSuccess: async (data) => {
      setSyncProgress(null);
      const { synced, skipped, failed } = data.results;

      if (synced > 0) {
        toast.success(`Synced ${synced} ${config.displayName} posts`, {
          description: buildSyncDescription(skipped, failed),
        });
        queryClient.invalidateQueries({ queryKey: ['calendar', params.brandId] });
        queryClient.invalidateQueries({ queryKey: ['content', params.brandId] });
      } else if (skipped > 0) {
        toast.info('No new posts to sync', {
          description: `All ${skipped} recent posts already imported`,
        });
      } else {
        toast.info('No posts found to sync', {
          description: `Try posting on ${config.displayName} first`,
        });
      }

      if (failed > 0 && data.results.errors) {
        console.error('Sync errors:', data.results.errors);
      }

      await params.refetchStatus();
    },
    onError: async (error) => {
      setSyncProgress(null);
      const message = error.message || `Failed to sync ${config.displayName} posts`;

      if (
        message.includes('wait') ||
        message.includes('minutes') ||
        /already in progress/i.test(message)
      ) {
        toast.warning('Sync cooldown active', { description: message });
      } else if (message.includes('not connected')) {
        toast.error(`${config.displayName} not connected`, {
          description: `Please connect your ${config.displayName} account first`,
        });
      } else {
        toast.error('Sync failed', { description: message });
      }

      await params.refetchStatus();
    },
  });

  return { mutation, syncProgress, config };
}

function getButtonText(params: {
  isLoading: boolean;
  inProgress: boolean;
  cooldownSeconds: number;
  displayName: string;
}): string {
  if (params.isLoading || params.inProgress) {
    return 'Syncing...';
  }

  if (params.cooldownSeconds > 0) {
    const mins = Math.floor(params.cooldownSeconds / 60);
    const secs = params.cooldownSeconds % 60;
    return `Cooldown ${mins}m ${secs}s`;
  }

  return `Sync ${params.displayName} Posts`;
}

export function useSocialSyncButtonState(brandId: string, platform: Platform) {
  const status = useSocialSyncStatus(brandId, platform);
  const sync = useSocialSyncMutation({
    brandId,
    platform,
    refetchStatus: status.refetchStatus,
  });

  const inProgress = Boolean(status.statusData?.inProgress);
  const isLoading = sync.mutation.isPending;
  const disabled = isLoading || inProgress || status.cooldownSeconds > 0;

  const buttonText = useMemo(
    () =>
      getButtonText({
        isLoading,
        inProgress,
        cooldownSeconds: status.cooldownSeconds,
        displayName: sync.config.displayName,
      }),
    [isLoading, inProgress, status.cooldownSeconds, sync.config.displayName]
  );

  return {
    buttonText,
    disabled,
    isLoading,
    inProgress,
    statusFetching: status.statusFetching,
    syncProgress: sync.syncProgress,
    handleSync: () => sync.mutation.mutate(),
  };
}
