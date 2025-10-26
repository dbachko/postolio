import { FileText, Calendar, CheckCircle, XCircle, MinusCircle, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

interface StatusBadgeProps {
  status: 'draft' | 'scheduled' | 'published' | 'failed' | 'skipped';
  isLoading?: boolean;
  retryCount?: number;
  className?: string;
}

export function StatusBadge({
  status,
  isLoading = false,
  retryCount = 0,
  className,
}: StatusBadgeProps) {
  const config = {
    draft: { icon: FileText, bgClass: 'bg-secondary text-secondary-foreground', label: 'Draft' },
    scheduled: { icon: Calendar, bgClass: 'bg-info text-info-foreground', label: 'Scheduled' },
    published: {
      icon: CheckCircle,
      bgClass: 'bg-success text-success-foreground',
      label: 'Published',
    },
    failed: {
      icon: XCircle,
      bgClass: 'bg-destructive text-destructive-foreground',
      label: 'Failed',
    },
    skipped: { icon: MinusCircle, bgClass: 'bg-warning text-warning-foreground', label: 'Skipped' },
  } as const;

  const { bgClass, icon: Icon, label } = config[status];

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium transition-all',
        bgClass,
        className
      )}
    >
      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      <span>{label}</span>
      {retryCount > 0 && (
        <span className="bg-muted rounded px-1.5 py-0.5 text-xs">Retry {retryCount}</span>
      )}
    </div>
  );
}
