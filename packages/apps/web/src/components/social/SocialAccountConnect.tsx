import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { brand as brandApi } from '@/lib/api';
import type { Brand } from '@/lib/api';
import { type Platform, getPlatformConfig } from '@/lib/platform-config';
import { SocialSyncButton } from './SocialSyncButton';

interface SocialProfile {
  id: string;
  username: string;
  account_type?: string;
  name?: string;
  followers_count?: number;
  media_count?: number;
  biography?: string;
  profile_picture_url?: string;
}

interface SocialAccountConnectProps {
  platform: Platform;
  brand: Brand;
  /** Show sync button when connected (default: true for platforms that support it) */
  showSync?: boolean;
  /** Custom action buttons to show when connected */
  customActions?: React.ReactNode;
  /** Callback when connection status changes */
  onConnectionChange?: (connected: boolean) => void;
}

export function SocialAccountConnect({
  platform,
  brand,
  showSync,
  customActions,
  onConnectionChange,
}: SocialAccountConnectProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const queryClient = useQueryClient();
  const config = getPlatformConfig(platform);

  // Determine if sync should be shown
  const shouldShowSync = showSync ?? config.features.publishing;

  // Check connection status
  const { data: connectionStatus, isLoading } = useQuery({
    queryKey: ['social-status', brand.id, platform],
    queryFn: () => brandApi.getSocialConnectionStatus(brand.id, platform),
    refetchOnWindowFocus: true,
  });

  // Initialize OAuth flow
  const connectMutation = useMutation({
    mutationFn: () => brandApi.initializeSocialOAuth(brand.id, platform),
    onSuccess: (data) => {
      // Open OAuth popup
      const popup = window.open(
        data.authUrl,
        `${platform}-oauth`,
        'width=600,height=700,scrollbars=yes,resizable=yes'
      );

      // Listen for success or error messages from popup
      const handleMessage = (event: MessageEvent) => {
        // Validate message origin
        const allowedOrigins = [window.location.origin];

        // Add API origin if different from app origin
        const apiUrl = import.meta.env.VITE_API_URL;
        if (apiUrl) {
          try {
            const apiOrigin = new URL(apiUrl).origin;
            if (apiOrigin !== window.location.origin) {
              allowedOrigins.push(apiOrigin);
            }
          } catch (_e) {
            // Invalid API URL, skip
          }
        }

        // Reject messages from untrusted origins
        if (!allowedOrigins.includes(event.origin)) {
          console.warn('Rejected OAuth message from untrusted origin:', event.origin);
          return;
        }

        // Validate message structure
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

      // Poll for popup closure as fallback
      const checkClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(checkClosed);
          setIsConnecting(false);
          // Refresh connection status
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

  // Disconnect
  const disconnectMutation = useMutation({
    mutationFn: () => brandApi.disconnectSocial(brand.id, platform),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['social-status', brand.id, platform],
      });
      onConnectionChange?.(false);
    },
    onError: (error) => {
      console.error(`${config.displayName} disconnect failed:`, error);
    },
  });

  // Refresh status
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

  const handleDisconnect = () => {
    if (
      window.confirm(
        `Are you sure you want to disconnect your ${config.displayName} account? This will stop content publishing.`
      )
    ) {
      disconnectMutation.mutate();
    }
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
          <div className="bg-muted h-20 animate-pulse rounded"></div>
        </CardContent>
      </Card>
    );
  }

  const isConnected = connectionStatus?.connected ?? false;
  const profile = connectionStatus?.profile as SocialProfile | null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {config.icon} {config.displayName} Connection
        </CardTitle>
        <CardDescription>{config.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Connection Status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div
              className={`h-2 w-2 rounded-full ${isConnected ? 'bg-foreground' : 'bg-muted-foreground'}`}
            />
            <span className="text-sm font-medium">
              {isConnected ? 'Connected' : 'Not Connected'}
            </span>
          </div>
          <Badge variant={isConnected ? 'default' : 'secondary'}>
            {isConnected ? 'Active' : 'Inactive'}
          </Badge>
        </div>

        {/* Connected Profile */}
        {isConnected && profile && (
          <div className="bg-muted rounded-lg border p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <Avatar
                  src={profile.profile_picture_url || null}
                  name={profile.name || profile.username}
                  alt={`@${profile.username}`}
                  size="lg"
                />
                <div>
                  <h3 className="font-medium">{profile.name || profile.username}</h3>
                  <a
                    href={`https://${platform}.com/${profile.username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary text-sm hover:underline"
                  >
                    @{profile.username}
                  </a>
                  <div className="mt-1 flex items-center space-x-4">
                    {profile.followers_count !== undefined && profile.followers_count !== null && (
                      <span className="text-muted-foreground text-xs">
                        {profile.followers_count.toLocaleString()} followers
                      </span>
                    )}
                    {profile.media_count !== undefined && profile.media_count !== null && (
                      <span className="text-muted-foreground text-xs">
                        {profile.media_count === 0
                          ? 'No posts yet'
                          : `${profile.media_count} posts`}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {profile.account_type && (
                <Badge
                  variant={profile.account_type === 'BUSINESS' ? 'default' : 'secondary'}
                  className="ml-2"
                >
                  {profile.account_type === 'BUSINESS'
                    ? 'Business'
                    : profile.account_type === 'CREATOR'
                      ? 'Creator'
                      : profile.account_type}
                </Badge>
              )}
            </div>
            {profile.biography && (
              <p className="text-muted-foreground mt-3 text-sm">{profile.biography}</p>
            )}
          </div>
        )}

        {/* Error Messages */}
        {connectMutation.error && (
          <Alert variant="destructive">
            <AlertDescription>
              {connectMutation.error.message || `Failed to connect ${config.displayName} account`}
            </AlertDescription>
          </Alert>
        )}

        {disconnectMutation.error && (
          <Alert variant="destructive">
            <AlertDescription>
              {disconnectMutation.error.message ||
                `Failed to disconnect ${config.displayName} account`}
            </AlertDescription>
          </Alert>
        )}

        {refreshStatusMutation.error && (
          <Alert variant="destructive">
            <AlertDescription>
              {refreshStatusMutation.error.message ||
                `Failed to refresh ${config.displayName} status`}
            </AlertDescription>
          </Alert>
        )}

        {/* Sync Info Alert - only show if sync is supported */}
        {isConnected && shouldShowSync && config.features.publishing && (
          <Alert variant="info">
            <AlertDescription className="text-sm">
              <strong>Sync your posts:</strong> Import your recent {config.displayName} posts to
              view them in Timeline and Calendar.
            </AlertDescription>
          </Alert>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap justify-end gap-2">
          {isConnected ? (
            <>
              <Button
                variant="outline"
                onClick={handleDisconnect}
                disabled={disconnectMutation.isPending}
                className="w-full sm:w-auto"
              >
                {disconnectMutation.isPending ? 'Disconnecting...' : 'Disconnect'}
              </Button>
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

        {/* Requirements Notice */}
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
