import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { brand as brandApi } from '@/lib/api';
import { getPlatformConfig } from '@/lib/platform-config';
import type { SocialAccountConnectProps } from './types';
import { extractSocialProfile } from './utils';
import {
  ConnectionLoadingCard,
  SocialAccountConnectCard,
} from './components/social-account-connect-card';
import {
  getSocialStatusQueryKey,
  useSocialConnectMutations,
} from './hooks/use-social-connect-mutations';

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
    queryKey: getSocialStatusQueryKey(brand.id, platform),
    queryFn: () => brandApi.getSocialConnectionStatus(brand.id, platform),
    refetchOnWindowFocus: true,
  });

  const { connectMutation, disconnectMutation, refreshStatusMutation } = useSocialConnectMutations({
    brandId: brand.id,
    platform,
    config,
    onConnectionChange,
    queryClient,
    setIsConnecting,
    setDisconnectDialogOpen,
  });

  if (isLoading) {
    return <ConnectionLoadingCard config={config} />;
  }

  const isConnected = (connectionStatus as any)?.connected ?? false;
  const profile = isConnected ? extractSocialProfile(connectionStatus) : null;

  return (
    <SocialAccountConnectCard
      platform={platform}
      brandId={brand.id}
      config={config}
      isConnected={isConnected}
      profile={profile}
      shouldShowSync={shouldShowSync}
      isConnecting={isConnecting}
      disconnectDialogOpen={disconnectDialogOpen}
      setDisconnectDialogOpen={setDisconnectDialogOpen}
      connectMutation={connectMutation}
      disconnectMutation={disconnectMutation}
      refreshStatusMutation={refreshStatusMutation}
      customActions={customActions}
    />
  );
}
