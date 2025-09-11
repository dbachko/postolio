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
    draft: {
      color: 'gray',
      icon: FileText,
      bgClass: 'bg-gray-50 text-gray-700',
      label: 'Draft',
    },
    scheduled: {
      color: 'blue',
      icon: Calendar,
      bgClass: 'bg-blue-50 text-blue-700',
      label: 'Scheduled',
    },
    published: {
      color: 'green',
      icon: CheckCircle,
      bgClass: 'bg-green-50 text-green-700',
      label: 'Published',
    },
    failed: {
      color: 'red',
      icon: XCircle,
      bgClass: 'bg-red-50 text-red-700',
      label: 'Failed',
    },
    skipped: {
      color: 'yellow',
      icon: MinusCircle,
      bgClass: 'bg-yellow-50 text-yellow-700',
      label: 'Skipped',
    },
  };

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
        <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-xs text-yellow-800">
          Retry {retryCount}
        </span>
      )}
    </div>
  );
}
