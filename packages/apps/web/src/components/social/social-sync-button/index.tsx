import { Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { Platform } from '@/lib/platform-config';

import { useSocialSyncButtonState } from './hooks/use-social-sync-button-state';

interface SocialSyncButtonProps {
  platform: Platform;
  brandId: string;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost';
  size?: 'default' | 'sm' | 'lg';
  className?: string;
}

export function SocialSyncButton({
  platform,
  brandId,
  variant = 'outline',
  size = 'default',
  className = '',
}: SocialSyncButtonProps) {
  const state = useSocialSyncButtonState(brandId, platform);

  return (
    <Button
      onClick={state.handleSync}
      disabled={state.disabled}
      variant={variant}
      size={size}
      className={className}
    >
      {state.isLoading || state.inProgress || state.statusFetching ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {state.syncProgress || state.buttonText}
        </>
      ) : (
        <>
          <RefreshCw className="mr-2 h-4 w-4" />
          {state.buttonText}
        </>
      )}
    </Button>
  );
}
