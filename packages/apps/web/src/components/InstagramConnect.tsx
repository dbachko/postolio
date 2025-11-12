import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { brand as brandApi } from '../lib/api';
import type { Brand } from '../lib/api';
import { InstagramSyncButton } from './InstagramSyncButton';
import { Avatar } from '@/components/ui/avatar';

interface InstagramProfile {
  id: string;
  username: string;
  account_type: string;
  name: string;
  followers_count?: number;
  media_count?: number;
  biography?: string;
  profile_picture_url?: string;
}

interface InstagramConnectProps {
  brand: Brand;
}

export function InstagramConnect({ brand }: InstagramConnectProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const queryClient = useQueryClient();

  // Check Instagram connection status
  const { data: connectionStatus, isLoading } = useQuery({
    queryKey: ['instagram-status', brand.id],
    queryFn: () => brandApi.getInstagramConnectionStatus(brand.id),
    refetchOnWindowFocus: true,
  });

  // Initialize OAuth flow
  const connectMutation = useMutation({
    mutationFn: () => brandApi.initializeInstagramOAuth(brand.id),
    onSuccess: (data) => {
      // Open OAuth popup
      const popup = window.open(
        data.authUrl,
        'instagram-oauth',
        'width=600,height=700,scrollbars=yes,resizable=yes'
      );

      // Listen for success or error messages from popup
      const handleMessage = (event: MessageEvent) => {
        if (event.data.type === 'INSTAGRAM_OAUTH_SUCCESS') {
          console.log('Instagram OAuth success:', event.data.data);
          setIsConnecting(false);
          queryClient.invalidateQueries({
            queryKey: ['instagram-status', brand.id],
          });
          window.removeEventListener('message', handleMessage);
        } else if (event.data.type === 'INSTAGRAM_OAUTH_ERROR') {
          console.error('Instagram OAuth error:', event.data.data);
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
            queryKey: ['instagram-status', brand.id],
          });
          window.removeEventListener('message', handleMessage);
        }
      }, 1000);

      setIsConnecting(true);
    },
    onError: (error) => {
      console.error('OAuth initialization failed:', error);
      setIsConnecting(false);
    },
  });

  // Disconnect Instagram
  const disconnectMutation = useMutation({
    mutationFn: () => brandApi.disconnectInstagram(brand.id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['instagram-status', brand.id],
      });
    },
    onError: (error) => {
      console.error('Instagram disconnect failed:', error);
    },
  });

  // Refresh Instagram status with fresh API data
  const refreshStatusMutation = useMutation({
    mutationFn: () => brandApi.getInstagramConnectionStatus(brand.id, true),
    onSuccess: (data) => {
      // Update the query cache with the fresh data instead of just invalidating
      queryClient.setQueryData(['instagram-status', brand.id], data);
    },
    onError: (error) => {
      console.error('Instagram status refresh failed:', error);
      // Don't invalidate the cache on error to prevent undefined state
    },
  });

  const handleConnect = () => {
    connectMutation.mutate();
  };

  const handleDisconnect = () => {
    if (
      window.confirm(
        'Are you sure you want to disconnect your Instagram account? This will stop content publishing.'
      )
    ) {
      disconnectMutation.mutate();
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Instagram Connection</CardTitle>
          <CardDescription>Checking connection status...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted h-20 animate-pulse rounded"></div>
        </CardContent>
      </Card>
    );
  }

  // Handle undefined connectionStatus gracefully
  const isConnected = connectionStatus?.connected ?? false;
  const profile = connectionStatus?.profile as InstagramProfile | null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Instagram Connection</CardTitle>
        <CardDescription>
          Connect your Instagram Business account to enable content publishing
        </CardDescription>
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
                  <h3 className="font-medium">{profile.name}</h3>
                  <a
                    href={`https://instagram.com/${profile.username}`}
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
              {connectMutation.error.message || 'Failed to connect Instagram account'}
            </AlertDescription>
          </Alert>
        )}

        {disconnectMutation.error && (
          <Alert variant="destructive">
            <AlertDescription>
              {disconnectMutation.error.message || 'Failed to disconnect Instagram account'}
            </AlertDescription>
          </Alert>
        )}

        {refreshStatusMutation.error && (
          <Alert variant="destructive">
            <AlertDescription>
              {refreshStatusMutation.error.message || 'Failed to refresh Instagram status'}
            </AlertDescription>
          </Alert>
        )}

        {/* Sync Info Alert */}
        {isConnected && (
          <Alert variant="info">
            <AlertDescription className="text-sm">
              <strong>Sync your posts:</strong> Import your recent Instagram posts to view them in
              Timeline and Calendar. Syncs up to 100 posts or 30 days of history.
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
              <InstagramSyncButton
                brandId={brand.id}
                variant="outline"
                className="w-full sm:w-auto"
              />
              <Button
                onClick={() => refreshStatusMutation.mutate()}
                variant="secondary"
                disabled={refreshStatusMutation.isPending}
                className="w-full sm:w-auto"
              >
                {refreshStatusMutation.isPending ? 'Refreshing...' : 'Refresh Status'}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={handleConnect}
              disabled={connectMutation.isPending || isConnecting}
              className="w-full sm:w-auto"
            >
              {isConnecting ? 'Connecting...' : 'Connect Instagram Account'}
            </Button>
          )}
        </div>

        {/* Requirements Notice */}
        {!isConnected && (
          <Alert variant="warning">
            <AlertDescription className="text-sm">
              <strong>Requirements:</strong> You need an Instagram Business or Creator account
              linked to a Facebook Page. Personal accounts cannot be used for automated posting.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
