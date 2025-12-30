import type { Platform } from '@/lib/platform-config';
import type { ProfileAvatarProps } from '@/components/ui/profile-avatar';

export interface SocialAccountsPickerOption {
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

export interface SocialAccountsPickerProps {
  options: SocialAccountsPickerOption[];
  value: string[];
  onChange: (value: string[]) => void;
  size?: ProfileAvatarProps['size'];
  disabled?: boolean;
  className?: string;
  addLabel?: string;
  addTooltip?: string;
  addButtonText?: string;
  addButtonTextMode?: 'always' | 'hover';
  required?: boolean;
  selectedLayout?: 'wrap' | 'scroll';
  searchPlaceholder?: string;
}
