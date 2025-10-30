import * as React from 'react';
import { cn } from '@/lib/utils';

export function Empty({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'from-muted/50 to-background flex h-full w-full flex-col items-center justify-center rounded-lg border bg-gradient-to-b text-center',
        className
      )}
      {...props}
    />
  );
}

export function EmptyHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('space-y-2 px-4', className)} {...props} />;
}

export function EmptyMedia({
  className,
  variant = 'icon',
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: 'icon' | 'image' }) {
  return (
    <div
      className={cn(
        'mx-auto flex items-center justify-center',
        variant === 'icon' && 'bg-muted text-muted-foreground rounded-full p-3',
        className
      )}
      {...props}
    />
  );
}

export function EmptyTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-foreground text-base font-semibold', className)} {...props} />;
}

export function EmptyDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-muted-foreground text-sm', className)} {...props} />;
}

export function EmptyContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('mt-4 flex items-center justify-center gap-2 px-4', className)} {...props} />
  );
}
