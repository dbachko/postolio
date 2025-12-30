import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { RefreshCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { brand as brandApi } from '@/lib/api';
import { type Platform, getPlatformConfig } from '@/lib/platform-config';
import { CACHE_TIMES, REFETCH_INTERVALS } from '@/lib/cache-config';

interface SocialSyncButtonProps {
  platform: Platform;
  brandId: string;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost';
  size?: 'default' | 'sm' | 'lg';
  className?: string;
}

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

export function SocialSyncButton({
  platform,
  brandId,
  variant = 'outline',
  size = 'default',
  className = '',
}: SocialSyncButtonProps) {
  const [syncProgress, setSyncProgress] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const config = getPlatformConfig(platform);

  // Poll backend for sync status to disable button if another sync is running
  const {
    data: statusData,
    refetch: refetchStatus,
    isFetching: statusFetching,
  } = useQuery<{
    inProgress: boolean;
    lockTtl?: number | null;
    cooldownRemaining?: number;
  }>({
    queryKey: ['social-sync-status', brandId, platform],
    queryFn: async () => brandApi.getSocialSyncStatus(brandId, platform),
    staleTime: CACHE_TIMES.STATIC,
    refetchOnWindowFocus: false,
    refetchInterval: (q) => {
      const data = q.state.data as any;
      // Only poll when sync is actively running; cooldown handled client-side
      if (data?.inProgress) return REFETCH_INTERVALS.FAST;
      return false;
    },
  });

  const [cooldownEndsAt, setCooldownEndsAt] = useState<number | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  useEffect(() => {
    const remaining = statusData?.cooldownRemaining;
    if (typeof remaining === 'number' && remaining > 0) {
      setCooldownEndsAt(Date.now() + remaining * 1000);
    } else {
      setCooldownEndsAt(null);
      setCooldownSeconds(0);
    }
  }, [statusData?.cooldownRemaining]);

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

  const syncMutation = useMutation<SyncResponse, Error>({
    mutationFn: async () => {
      setSyncProgress('Starting sync...');
      const response = await brandApi.syncSocialPosts(brandId, platform, {
        maxPosts: 100,
        maxDays: 30,
      });
      return response;
    },
    onSuccess: async (data) => {
      setSyncProgress(null);
      const { synced, skipped, failed } = data.results;

      if (synced > 0) {
        toast.success(`Synced ${synced} ${config.displayName} posts`, {
          description:
            skipped > 0 || failed > 0
              ? `${skipped > 0 ? `${skipped} skipped` : ''}${skipped > 0 && failed > 0 ? ', ' : ''}${failed > 0 ? `${failed} failed` : ''}`
              : 'Your posts are now available in the Timeline and Calendar',
        });

        // Invalidate relevant queries to refresh UI
        queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
        queryClient.invalidateQueries({ queryKey: ['content', brandId] });
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

      // Refresh status once to capture new cooldown info
      await refetchStatus();
    },
    onError: async (error: Error) => {
      setSyncProgress(null);
      const errorMessage = error.message || `Failed to sync ${config.displayName} posts`;

      if (
        errorMessage.includes('wait') ||
        errorMessage.includes('minutes') ||
        /already in progress/i.test(errorMessage)
      ) {
        // Rate limit error
        toast.warning('Sync cooldown active', {
          description: errorMessage,
        });
      } else if (errorMessage.includes('not connected')) {
        toast.error(`${config.displayName} not connected`, {
          description: `Please connect your ${config.displayName} account first`,
        });
      } else {
        toast.error('Sync failed', {
          description: errorMessage,
        });
      }

      await refetchStatus();
    },
  });

  const handleSync = () => {
    syncMutation.mutate();
  };

  const isLoading = syncMutation.isPending;
  const inProgress = statusData?.inProgress;
  const disabled = isLoading || !!inProgress || cooldownSeconds > 0;

  const buttonText = useMemo(() => {
    if (isLoading || inProgress) return 'Syncing...';
    if (cooldownSeconds > 0) {
      const mins = Math.floor(cooldownSeconds / 60);
      const secs = cooldownSeconds % 60;
      return `Cooldown ${mins}m ${secs}s`;
    }
    return `Sync ${config.displayName} Posts`;
  }, [isLoading, inProgress, cooldownSeconds, config.displayName]);

  return (
    <Button
      onClick={handleSync}
      disabled={disabled}
      variant={variant}
      size={size}
      className={className}
    >
      {isLoading || inProgress || statusFetching ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {syncProgress || buttonText}
        </>
      ) : (
        <>
          <RefreshCw className="mr-2 h-4 w-4" />
          {buttonText}
        </>
      )}
    </Button>
  );
}
