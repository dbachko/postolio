import type { CSSProperties } from 'react';
import { ProfileAvatar, type ProfileAvatarProps } from '@/components/ui/profile-avatar';
import { getPlatformConfig } from '@/lib/platform-config';
import { getPlatformIcon } from '@/components/icons/platform-icons';
import { cn } from '@/lib/utils';
import type { SocialAccountAvatarProps } from './types';

const badgeSizeMap: Record<NonNullable<ProfileAvatarProps['size']>, string> = {
  xs: 'h-3.5 w-3.5',
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
  xl: 'h-7 w-7',
};

const boxSizeMap: Record<NonNullable<ProfileAvatarProps['size']>, string> = {
  xs: 'h-6 w-6',
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
  xl: 'h-16 w-16',
};

const iconSizeMap: Record<NonNullable<ProfileAvatarProps['size']>, string> = {
  xs: 'h-2 w-2',
  sm: 'h-2.5 w-2.5',
  md: 'h-3 w-3',
  lg: 'h-3.5 w-3.5',
  xl: 'h-4 w-4',
};

function getFallbackInitial(name: string): string {
  const trimmed = (name || '').trim();
  if (!trimmed) {
    return 'U';
  }
  const withoutAt = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  const letter = withoutAt.trim()[0] || 'U';
  return letter.toUpperCase();
}

export function SocialAccountAvatar({
  platform,
  name,
  src,
  size = 'md',
  selected = false,
  muted = true,
  disabled = false,
  className,
}: SocialAccountAvatarProps) {
  const config = getPlatformConfig(platform);
  const badgeSize = badgeSizeMap[size] || badgeSizeMap.md;
  const boxSize = boxSizeMap[size] || boxSizeMap.md;
  const iconSize = iconSizeMap[size] || iconSizeMap.md;
  const ringWidthClass = selected ? 'border-[3px]' : 'border';
  const ringColor = selected ? config.color : 'hsl(var(--border))';
  const fallbackInitial = getFallbackInitial(name);

  return (
    <div
      className={cn(
        'relative inline-flex rounded-full transition-[box-shadow] duration-150 ease-out hover:shadow-[inset_0_0_0_2px_var(--ring-color)]',
        boxSize,
        disabled && 'opacity-50',
        className
      )}
      style={{ '--ring-color': ringColor } as CSSProperties}
      aria-hidden="true"
    >
      <ProfileAvatar
        src={src}
        name={fallbackInitial}
        alt={name}
        size={size}
        className={cn(
          'box-border border-[color:var(--ring-color)]',
          ringWidthClass,
          muted && !selected && 'opacity-70 grayscale'
        )}
      />
      <div
        className={cn(
          'bg-background border-border pointer-events-none absolute right-0.5 bottom-0.5 flex items-center justify-center rounded-full border',
          badgeSize
        )}
        style={{ color: config.color }}
      >
        {getPlatformIcon(platform, iconSize)}
      </div>
    </div>
  );
}
