import type { Brand } from '@/lib/api';
import type { Platform } from '@/lib/platform-config';

export interface SocialProfile {
  id: string;
  username: string;
  account_type?: string;
  name?: string;
  followers_count?: number;
  media_count?: number;
  biography?: string;
  profile_picture_url?: string;
}

export interface SocialAccountConnectProps {
  platform: Platform;
  brand: Brand;
  showSync?: boolean;
  customActions?: React.ReactNode;
  onConnectionChange?: (connected: boolean) => void;
}
