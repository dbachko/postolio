import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { brand as brandApi } from '@/lib/api';
import { getPlatformConfig } from '@/lib/platform-config';
import { SocialSyncButton } from '../social-sync-button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import type { SocialAccountConnectProps } from './types';
import { extractSocialProfile } from './utils';
import { ConnectionStatusRow } from './components/connection-status-row';
import { ConnectedProfileCard } from './components/connected-profile-card';
import { ErrorAlerts } from './components/error-alerts';

export function SocialAccountConnect({
  platform,
  brand,
  showSync,
  customActions,
  onConnectionChange,
}: SocialAccountConnectProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const config = getPlatformConfig(platform);

  const shouldShowSync = showSync ?? config.features.publishing;

  const { data: connectionStatus, isLoading } = useQuery({
    queryKey: ['social-status', brand.id, platform],
    queryFn: () => brandApi.getSocialConnectionStatus(brand.id, platform),
    refetchOnWindowFocus: true,
  });

  const connectMutation = useMutation({
    mutationFn: () => brandApi.initializeSocialOAuth(brand.id, platform),
    onSuccess: (data) => {
      const popup = window.open(
        data.authUrl,
        `${platform}-oauth`,
        'width=600,height=700,scrollbars=yes,resizable=yes'
      );

      const handleMessage = (event: MessageEvent) => {
        const allowedOrigins = [window.location.origin];
        const apiUrl = import.meta.env.VITE_API_URL;
        if (apiUrl) {
          try {
            const apiOrigin = new URL(apiUrl).origin;
            if (apiOrigin !== window.location.origin) {
              allowedOrigins.push(apiOrigin);
            }
          } catch (_e) {
            // ignore invalid API URL
          }
        }

        if (!allowedOrigins.includes(event.origin)) {
          console.warn('Rejected OAuth message from untrusted origin:', event.origin);
          return;
        }

        if (!event.data || typeof event.data.type !== 'string') {
          return;
        }

        if (event.data.type === `${platform.toUpperCase()}_OAUTH_SUCCESS`) {
          console.log(`${config.displayName} OAuth success`);
          setIsConnecting(false);
          queryClient.invalidateQueries({
            queryKey: ['social-status', brand.id, platform],
          });
          onConnectionChange?.(true);
          window.removeEventListener('message', handleMessage);
        } else if (event.data.type === `${platform.toUpperCase()}_OAUTH_ERROR`) {
          console.error(`${config.displayName} OAuth error`);
          setIsConnecting(false);
          window.removeEventListener('message', handleMessage);
        }
      };

      window.addEventListener('message', handleMessage);

      const checkClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(checkClosed);
          setIsConnecting(false);
          queryClient.invalidateQueries({
            queryKey: ['social-status', brand.id, platform],
          });
          window.removeEventListener('message', handleMessage);
        }
      }, 1000);

      setIsConnecting(true);
    },
    onError: (error) => {
      console.error(`${config.displayName} OAuth initialization failed:`, error);
      setIsConnecting(false);
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: (options: { removeImportedPosts: boolean }) =>
      brandApi.disconnectSocial(brand.id, platform, options),
    onSuccess: () => {
      setDisconnectDialogOpen(false);
      queryClient.invalidateQueries({
        queryKey: ['social-status', brand.id, platform],
      });
      onConnectionChange?.(false);
    },
    onError: (error) => {
      console.error(`${config.displayName} disconnect failed:`, error);
    },
  });

  const refreshStatusMutation = useMutation({
    mutationFn: () => brandApi.getSocialConnectionStatus(brand.id, platform, true),
    onSuccess: (data) => {
      queryClient.setQueryData(['social-status', brand.id, platform], data);
    },
    onError: (error) => {
      console.error(`${config.displayName} status refresh failed:`, error);
    },
  });

  const handleConnect = () => {
    connectMutation.mutate();
  };

  const handleDisconnectKeepPosts = () => {
    disconnectMutation.mutate({ removeImportedPosts: false });
  };

  const handleDisconnectRemoveImported = () => {
    disconnectMutation.mutate({ removeImportedPosts: true });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {config.icon} {config.displayName} Connection
          </CardTitle>
          <CardDescription>Checking connection status...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted h-20 animate-pulse rounded" />
        </CardContent>
      </Card>
    );
  }

  const isConnected = (connectionStatus as any)?.connected ?? false;
  const profile = isConnected ? extractSocialProfile(connectionStatus) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {config.icon} {config.displayName} Connection
        </CardTitle>
        <CardDescription>{config.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ConnectionStatusRow isConnected={isConnected} />

        {isConnected && profile && <ConnectedProfileCard platform={platform} profile={profile} />}

        <ErrorAlerts
          platformLabel={config.displayName}
          connectErrorMessage={(connectMutation.error as any)?.message}
          disconnectErrorMessage={(disconnectMutation.error as any)?.message}
          refreshErrorMessage={(refreshStatusMutation.error as any)?.message}
        />

        {isConnected && shouldShowSync && config.features.publishing && (
          <Alert variant="info">
            <AlertDescription className="text-sm">
              <strong>Sync your posts:</strong> Import your recent {config.displayName} posts to
              view them in Timeline and Calendar.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {isConnected ? (
            <>
              <AlertDialog open={disconnectDialogOpen} onOpenChange={setDisconnectDialogOpen}>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={disconnectMutation.isPending}
                    className="w-full sm:w-auto"
                  >
                    {disconnectMutation.isPending ? 'Disconnecting...' : 'Disconnect'}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Disconnect {config.displayName} account?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will stop publishing and syncing for this {config.displayName} account.
                      Choose whether to keep or remove posts that were imported from this account.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={disconnectMutation.isPending}>
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      disabled={disconnectMutation.isPending}
                      onClick={handleDisconnectKeepPosts}
                    >
                      Keep imported posts
                    </AlertDialogAction>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      disabled={disconnectMutation.isPending}
                      onClick={handleDisconnectRemoveImported}
                    >
                      Remove imported posts
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              {shouldShowSync && config.features.publishing && (
                <SocialSyncButton
                  platform={platform}
                  brandId={brand.id}
                  variant="outline"
                  className="w-full sm:w-auto"
                />
              )}
              <Button
                onClick={() => refreshStatusMutation.mutate()}
                variant="secondary"
                disabled={refreshStatusMutation.isPending}
                className="w-full sm:w-auto"
              >
                {refreshStatusMutation.isPending ? 'Refreshing...' : 'Refresh Status'}
              </Button>
              {customActions}
            </>
          ) : (
            <Button
              variant="outline"
              onClick={handleConnect}
              disabled={connectMutation.isPending || isConnecting}
              className="w-full sm:w-auto"
            >
              {isConnecting ? 'Connecting...' : `Connect ${config.displayName} Account`}
            </Button>
          )}
        </div>

        {!isConnected && (
          <Alert variant="warning">
            <AlertDescription className="text-sm">
              <strong>Requirements:</strong> {config.requirements}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
