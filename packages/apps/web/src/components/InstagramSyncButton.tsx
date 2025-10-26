import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { RefreshCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { brand as brandApi } from '../lib/api';

interface InstagramSyncButtonProps {
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

export function InstagramSyncButton({
  brandId,
  variant = 'outline',
  size = 'default',
  className = '',
}: InstagramSyncButtonProps) {
  const [syncProgress, setSyncProgress] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const syncMutation = useMutation<SyncResponse, Error>({
    mutationFn: async () => {
      setSyncProgress('Starting sync...');
      const response = await brandApi.syncInstagramPosts(brandId, {
        maxPosts: 100,
        maxDays: 30,
      });
      return response;
    },
    onSuccess: (data) => {
      setSyncProgress(null);
      const { synced, skipped, failed } = data.results;

      if (synced > 0) {
        toast.success(`Synced ${synced} Instagram posts`, {
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
          description: 'Try posting on Instagram first',
        });
      }

      if (failed > 0 && data.results.errors) {
        console.error('Sync errors:', data.results.errors);
      }
    },
    onError: (error: Error) => {
      setSyncProgress(null);
      const errorMessage = error.message || 'Failed to sync Instagram posts';

      if (errorMessage.includes('wait') || errorMessage.includes('minutes')) {
        // Rate limit error
        toast.warning('Sync cooldown active', {
          description: errorMessage,
        });
      } else if (errorMessage.includes('not connected')) {
        toast.error('Instagram not connected', {
          description: 'Please connect your Instagram account first',
        });
      } else {
        toast.error('Sync failed', {
          description: errorMessage,
        });
      }
    },
  });

  const handleSync = () => {
    syncMutation.mutate();
  };

  const isLoading = syncMutation.isPending;

  return (
    <Button
      onClick={handleSync}
      disabled={isLoading}
      variant={variant}
      size={size}
      className={className}
    >
      {isLoading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {syncProgress || 'Syncing...'}
        </>
      ) : (
        <>
          <RefreshCw className="mr-2 h-4 w-4" />
          Sync Instagram Posts
        </>
      )}
    </Button>
  );
}
