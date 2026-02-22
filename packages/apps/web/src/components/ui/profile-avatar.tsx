import { useMemo } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

export type ProfileAvatarProps = {
  src?: string | null;
  name?: string | null;
  alt?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  imageClassName?: string;
};

function getInitials(name?: string | null): string {
  const n = (name || '').trim();
  if (!n) {
    return 'U';
  }
  const parts = n.split(/[\s\u00A0]+/).filter(Boolean);
  if (parts.length === 1) {
    const s = parts[0].slice(0, 2).toUpperCase();
    return s || 'U';
  }
  const first = parts[0][0] || '';
  const last = parts[parts.length - 1][0] || '';
  const out = (first + last).toUpperCase();
  return out || 'U';
}

const sizeMap: Record<NonNullable<ProfileAvatarProps['size']>, string> = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-16 w-16 text-lg',
};

export function ProfileAvatar({
  src,
  name,
  alt,
  size = 'md',
  className,
  imageClassName,
}: ProfileAvatarProps) {
  const initials = useMemo(() => getInitials(name), [name]);
  const sizeCls = sizeMap[size] || sizeMap.md;
  const label = alt || name || 'avatar';

  return (
    <Avatar className={cn(sizeCls, className)} aria-label={label}>
      {src ? <AvatarImage src={src} alt={label} loading="lazy" className={imageClassName} /> : null}
      <AvatarFallback>{initials}</AvatarFallback>
    </Avatar>
  );
}
