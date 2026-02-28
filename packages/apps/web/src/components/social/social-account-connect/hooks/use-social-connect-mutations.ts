import { useMutation, type useQueryClient } from '@tanstack/react-query';
import { brand as brandApi } from '@/lib/api';
import type { getPlatformConfig } from '@/lib/platform-config';
import type { SocialAccountConnectProps } from '../types';

type PlatformConfig = ReturnType<typeof getPlatformConfig>;

type ConnectMutationParams = {
  brandId: string;
  platform: SocialAccountConnectProps['platform'];
  config: PlatformConfig;
  onConnectionChange?: (connected: boolean) => void;
  queryClient: ReturnType<typeof useQueryClient>;
  setIsConnecting: (next: boolean) => void;
  setDisconnectDialogOpen: (next: boolean) => void;
};

export function getSocialStatusQueryKey(
  brandId: string,
  platform: SocialAccountConnectProps['platform']
) {
  return ['social-status', brandId, platform];
}

function getAllowedOAuthOrigins() {
  const allowedOrigins = [window.location.origin];
  const apiUrl = import.meta.env.VITE_API_URL;
  if (!apiUrl) {
    return allowedOrigins;
  }

  try {
    const apiOrigin = new URL(apiUrl).origin;
    if (apiOrigin !== window.location.origin) {
      allowedOrigins.push(apiOrigin);
    }
  } catch {
    // ignore invalid API URL
  }

  return allowedOrigins;
}

function openOAuthPopup({
  authUrl,
  platform,
  config,
  queryKey,
  queryClient,
  setIsConnecting,
  onConnectionChange,
}: {
  authUrl: string;
  platform: SocialAccountConnectProps['platform'];
  config: PlatformConfig;
  queryKey: ReturnType<typeof getSocialStatusQueryKey>;
  queryClient: ReturnType<typeof useQueryClient>;
  setIsConnecting: (next: boolean) => void;
  onConnectionChange?: (connected: boolean) => void;
}) {
  const popup = window.open(
    authUrl,
    `${platform}-oauth`,
    'width=600,height=700,scrollbars=yes,resizable=yes'
  );

  const handleMessage = (event: MessageEvent) => {
    if (!getAllowedOAuthOrigins().includes(event.origin)) {
      console.warn('Rejected OAuth message from untrusted origin:', event.origin);
      return;
    }

    if (!event.data || typeof event.data.type !== 'string') {
      return;
    }

    if (event.data.type === `${platform.toUpperCase()}_OAUTH_SUCCESS`) {
      setIsConnecting(false);
      void queryClient.invalidateQueries({ queryKey });
      onConnectionChange?.(true);
      window.removeEventListener('message', handleMessage);
      return;
    }

    if (event.data.type === `${platform.toUpperCase()}_OAUTH_ERROR`) {
      console.error(`${config.displayName} OAuth error`);
      setIsConnecting(false);
      window.removeEventListener('message', handleMessage);
    }
  };

  window.addEventListener('message', handleMessage);

  const checkClosed = setInterval(() => {
    if (!popup?.closed) {
      return;
    }

    clearInterval(checkClosed);
    setIsConnecting(false);
    void queryClient.invalidateQueries({ queryKey });
    window.removeEventListener('message', handleMessage);
  }, 1000);

  setIsConnecting(true);
}

export function useSocialConnectMutations({
  brandId,
  platform,
  config,
  onConnectionChange,
  queryClient,
  setIsConnecting,
  setDisconnectDialogOpen,
}: ConnectMutationParams) {
  const queryKey = getSocialStatusQueryKey(brandId, platform);

  const connectMutation = useMutation({
    mutationFn: () => brandApi.initializeSocialOAuth(brandId, platform),
    onSuccess: (data) => {
      openOAuthPopup({
        authUrl: data.authUrl,
        platform,
        config,
        queryKey,
        queryClient,
        setIsConnecting,
        onConnectionChange,
      });
    },
    onError: (error) => {
      console.error(`${config.displayName} OAuth initialization failed:`, error);
      setIsConnecting(false);
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: (options: { removeImportedPosts: boolean }) =>
      brandApi.disconnectSocial(brandId, platform, options),
    onSuccess: () => {
      setDisconnectDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey });
      onConnectionChange?.(false);
    },
    onError: (error) => {
      console.error(`${config.displayName} disconnect failed:`, error);
    },
  });

  const refreshStatusMutation = useMutation({
    mutationFn: () => brandApi.getSocialConnectionStatus(brandId, platform, true),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
    },
    onError: (error) => {
      console.error(`${config.displayName} status refresh failed:`, error);
    },
  });

  return { connectMutation, disconnectMutation, refreshStatusMutation };
}
