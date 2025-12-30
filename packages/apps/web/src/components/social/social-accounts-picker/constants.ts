import type { ProfileAvatarProps } from '@/components/ui/profile-avatar';

type AvatarSize = NonNullable<ProfileAvatarProps['size']>;

export type SocialAccountsPickerSizeConfig = {
  triggerBoxClass: string;
  triggerBoxWidthClass: string;
  triggerBoxHeightClass: string;
  plusIconClass: string;
  expandWidthVariantClass: string;
};

export const SOCIAL_ACCOUNTS_PICKER_SIZE_CONFIG: Record<
  AvatarSize,
  SocialAccountsPickerSizeConfig
> = {
  xs: {
    triggerBoxClass: 'h-6 w-6',
    triggerBoxWidthClass: 'w-6',
    triggerBoxHeightClass: 'h-6',
    plusIconClass: 'h-3 w-3',
    expandWidthVariantClass: 'group-hover:w-36',
  },
  sm: {
    triggerBoxClass: 'h-8 w-8',
    triggerBoxWidthClass: 'w-8',
    triggerBoxHeightClass: 'h-8',
    plusIconClass: 'h-3.5 w-3.5',
    expandWidthVariantClass: 'group-hover:w-40',
  },
  md: {
    triggerBoxClass: 'h-10 w-10',
    triggerBoxWidthClass: 'w-10',
    triggerBoxHeightClass: 'h-10',
    plusIconClass: 'h-4 w-4',
    expandWidthVariantClass: 'group-hover:w-44',
  },
  lg: {
    triggerBoxClass: 'h-12 w-12',
    triggerBoxWidthClass: 'w-12',
    triggerBoxHeightClass: 'h-12',
    plusIconClass: 'h-5 w-5',
    expandWidthVariantClass: 'group-hover:w-52',
  },
  xl: {
    triggerBoxClass: 'h-16 w-16',
    triggerBoxWidthClass: 'w-16',
    triggerBoxHeightClass: 'h-16',
    plusIconClass: 'h-6 w-6',
    expandWidthVariantClass: 'group-hover:w-60',
  },
};
