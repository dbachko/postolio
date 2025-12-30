import type { ProfileAvatarProps } from '@/components/ui/profile-avatar';
import type { Platform } from '@/lib/platform-config';

export type SocialAccountAvatarProps = {
  platform: Platform;
  name: string;
  src?: string | null;
  size?: ProfileAvatarProps['size'];
  selected?: boolean;
  muted?: boolean;
  disabled?: boolean;
  className?: string;
};
