import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getContentDisplayStatus } from '@/utils/content-status';
import type { PostStatus } from './PostStatusCard';

interface PostStatusBadgeProps {
  status: PostStatus;
  generationParams?: {
    processing?: {
      active: boolean;
      operation: 'scheduling';
      startedAt: string;
      operationId?: string;
    };
    [key: string]: unknown;
  } | null;
  schedulingError?: string | null;
  scheduledAt?: string | Date | null;
  className?: string;
}

export function PostStatusBadge({
  status,
  generationParams,
  schedulingError,
  scheduledAt,
  className,
}: PostStatusBadgeProps) {
  const display = getContentDisplayStatus({
    id: 'post-status-badge',
    status,
    generationParams,
    schedulingError,
    scheduledAt,
  });

  return (
    <Badge variant={display.variant || 'default'} className={cn('gap-1', className)}>
      {display.showSpinner && <Loader2 className="h-3 w-3 animate-spin" />}
      {display.label}
    </Badge>
  );
}
