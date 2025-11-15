import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';

export type AvatarProps = {
  src?: string | null;
  name?: string | null;
  alt?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
};

function getInitials(name?: string | null): string {
  const n = (name || '').trim();
  if (!n) return 'U';
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

const sizeMap: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-16 w-16 text-lg',
};

export function Avatar({ src, name, alt, size = 'md', className }: AvatarProps) {
  const [errored, setErrored] = useState(false);
  const initials = useMemo(() => getInitials(name), [name]);
  const showFallback = !src || errored;
  const sizeCls = sizeMap[size] || sizeMap.md;

  if (showFallback) {
    return (
      <div
        className={cn(
          'bg-muted text-muted-foreground inline-flex items-center justify-center rounded-full select-none',
          sizeCls,
          className
        )}
        aria-label={alt || name || 'avatar'}
      >
        {initials}
      </div>
    );
  }

  return (
    <img
      src={src || undefined}
      alt={alt || name || 'avatar'}
      className={cn('rounded-full object-cover', sizeCls, className)}
      onError={() => setErrored(true)}
      loading="lazy"
    />
  );
}
