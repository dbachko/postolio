import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { getPlatformConfig } from '@/lib/platform-config';
import { SocialSyncButton } from '../../social-sync-button';
import type { SocialAccountConnectProps } from '../types';
import { ConnectedProfileCard } from './connected-profile-card';
import { ConnectionStatusRow } from './connection-status-row';
import { ErrorAlerts } from './error-alerts';
import type { useSocialConnectMutations } from '../hooks/use-social-connect-mutations';
import type { extractSocialProfile } from '../utils';

type PlatformConfig = ReturnType<typeof getPlatformConfig>;
type SocialConnectMutations = ReturnType<typeof useSocialConnectMutations>;

type ConnectionActionsProps = {
  isConnected: boolean;
  shouldShowSync: boolean;
  platform: SocialAccountConnectProps['platform'];
  brandId: string;
  config: PlatformConfig;
  isConnecting: boolean;
  disconnectDialogOpen: boolean;
  setDisconnectDialogOpen: (next: boolean) => void;
  connectMutation: SocialConnectMutations['connectMutation'];
  disconnectMutation: SocialConnectMutations['disconnectMutation'];
  refreshStatusMutation: SocialConnectMutations['refreshStatusMutation'];
  onConnect: () => void;
  customActions: SocialAccountConnectProps['customActions'];
};

export type SocialAccountConnectCardProps = {
  platform: SocialAccountConnectProps['platform'];
  brandId: string;
  config: PlatformConfig;
  isConnected: boolean;
  profile: ReturnType<typeof extractSocialProfile> | null;
  shouldShowSync: boolean;
  isConnecting: boolean;
  disconnectDialogOpen: boolean;
  setDisconnectDialogOpen: (next: boolean) => void;
  connectMutation: SocialConnectMutations['connectMutation'];
  disconnectMutation: SocialConnectMutations['disconnectMutation'];
  refreshStatusMutation: SocialConnectMutations['refreshStatusMutation'];
  customActions: SocialAccountConnectProps['customActions'];
};

export function ConnectionLoadingCard({ config }: { config: PlatformConfig }) {
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

function ConnectedActions({
  shouldShowSync,
  platform,
  brandId,
  config,
  disconnectDialogOpen,
  setDisconnectDialogOpen,
  disconnectMutation,
  refreshStatusMutation,
  customActions,
}: Pick<
  ConnectionActionsProps,
  | 'shouldShowSync'
  | 'platform'
  | 'brandId'
  | 'config'
  | 'disconnectDialogOpen'
  | 'setDisconnectDialogOpen'
  | 'disconnectMutation'
  | 'refreshStatusMutation'
  | 'customActions'
>) {
  return (
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
              This will stop publishing and syncing for this {config.displayName} account. Choose
              whether to keep or remove posts that were imported from this account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnectMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={disconnectMutation.isPending}
              onClick={() => disconnectMutation.mutate({ removeImportedPosts: false })}
            >
              Keep imported posts
            </AlertDialogAction>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={disconnectMutation.isPending}
              onClick={() => disconnectMutation.mutate({ removeImportedPosts: true })}
            >
              Remove imported posts
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {shouldShowSync && config.features.publishing && (
        <SocialSyncButton
          platform={platform}
          brandId={brandId}
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
  );
}

function ConnectionActions({
  isConnected,
  shouldShowSync,
  platform,
  brandId,
  config,
  isConnecting,
  disconnectDialogOpen,
  setDisconnectDialogOpen,
  connectMutation,
  disconnectMutation,
  refreshStatusMutation,
  onConnect,
  customActions,
}: ConnectionActionsProps) {
  if (!isConnected) {
    return (
      <Button
        variant="outline"
        onClick={onConnect}
        disabled={connectMutation.isPending || isConnecting}
        className="w-full sm:w-auto"
      >
        {isConnecting ? 'Connecting...' : `Connect ${config.displayName} Account`}
      </Button>
    );
  }

  return (
    <ConnectedActions
      shouldShowSync={shouldShowSync}
      platform={platform}
      brandId={brandId}
      config={config}
      disconnectDialogOpen={disconnectDialogOpen}
      setDisconnectDialogOpen={setDisconnectDialogOpen}
      disconnectMutation={disconnectMutation}
      refreshStatusMutation={refreshStatusMutation}
      customActions={customActions}
    />
  );
}

export function SocialAccountConnectCard({
  platform,
  brandId,
  config,
  isConnected,
  profile,
  shouldShowSync,
  isConnecting,
  disconnectDialogOpen,
  setDisconnectDialogOpen,
  connectMutation,
  disconnectMutation,
  refreshStatusMutation,
  customActions,
}: SocialAccountConnectCardProps) {
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
          <ConnectionActions
            isConnected={isConnected}
            shouldShowSync={shouldShowSync}
            platform={platform}
            brandId={brandId}
            config={config}
            isConnecting={isConnecting}
            disconnectDialogOpen={disconnectDialogOpen}
            setDisconnectDialogOpen={setDisconnectDialogOpen}
            connectMutation={connectMutation}
            disconnectMutation={disconnectMutation}
            refreshStatusMutation={refreshStatusMutation}
            onConnect={() => connectMutation.mutate()}
            customActions={customActions}
          />
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
