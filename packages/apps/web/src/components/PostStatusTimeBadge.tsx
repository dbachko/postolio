import * as React from 'react';
import { AlertTriangle, CheckCircle2, Clock, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getPostStatusTextClass, type CalendarPostStatus } from '@/utils/post-status-colors';

type Variant = 'inline' | 'pill';

const iconByStatus: Record<string, LucideIcon> = {
  draft: Clock,
  scheduled: Clock,
  published: CheckCircle2,
  failed: AlertTriangle,
  skipped: AlertTriangle,
  placeholder: Clock,
};

export interface PostStatusTimeBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: CalendarPostStatus;
  variant?: Variant;
  iconClassName?: string;
}

export const PostStatusTimeBadge = React.forwardRef<HTMLSpanElement, PostStatusTimeBadgeProps>(
  ({ status, variant = 'inline', className, iconClassName, children, ...props }, ref) => {
    const Icon = iconByStatus[String(status)] ?? Clock;
    const statusTextClass = getPostStatusTextClass(status);

    return (
      <span
        ref={ref}
        className={cn(
          variant === 'pill'
            ? 'bg-background/80 border-border inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] leading-none whitespace-nowrap backdrop-blur-sm'
            : 'inline-flex shrink-0 items-center gap-1.5 text-[11px] leading-none whitespace-nowrap',
          statusTextClass,
          className
        )}
        {...props}
      >
        <Icon className={cn('h-3.5 w-3.5', iconClassName)} />
        {children}
      </span>
    );
  }
);

PostStatusTimeBadge.displayName = 'PostStatusTimeBadge';
