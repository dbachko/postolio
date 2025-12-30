import type { ProfileAvatarProps } from '@/components/ui/profile-avatar';
import type { Platform } from '@/lib/platform-config';

export interface SocialAvatarMultiSelectOption {
  id: string;
  platform: Platform;
  /** Short display label (e.g., "@account" or "Page Name"). */
  label?: string;
  /** Tooltip/aria label (defaults to "Platform · label"). */
  tooltipLabel?: string;
  /** Name used for avatar initials fallback (defaults to label). */
  avatarName?: string;
  avatarUrl?: string | null;
  disabled?: boolean;
}

export interface SocialAvatarMultiSelectProps {
  options: SocialAvatarMultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  size?: ProfileAvatarProps['size'];
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}
