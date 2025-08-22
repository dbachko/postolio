import { 
  FileText, 
  Calendar, 
  CheckCircle, 
  XCircle, 
  MinusCircle,
  Loader2 
} from 'lucide-react'
import { cn } from '../lib/utils'

interface StatusBadgeProps {
  status: 'draft' | 'scheduled' | 'published' | 'failed' | 'skipped'
  isLoading?: boolean
  retryCount?: number
  className?: string
}

export function StatusBadge({ 
  status, 
  isLoading = false, 
  retryCount = 0, 
  className 
}: StatusBadgeProps) {
  const config = {
    draft: { 
      color: 'gray', 
      icon: FileText,
      bgClass: 'bg-gray-50 text-gray-700',
      label: 'Draft'
    },
    scheduled: { 
      color: 'blue', 
      icon: Calendar,
      bgClass: 'bg-blue-50 text-blue-700',
      label: 'Scheduled'
    },
    published: { 
      color: 'green', 
      icon: CheckCircle,
      bgClass: 'bg-green-50 text-green-700',
      label: 'Published'
    },
    failed: { 
      color: 'red', 
      icon: XCircle,
      bgClass: 'bg-red-50 text-red-700',
      label: 'Failed'
    },
    skipped: { 
      color: 'yellow', 
      icon: MinusCircle,
      bgClass: 'bg-yellow-50 text-yellow-700',
      label: 'Skipped'
    }
  }
  
  const { bgClass, icon: Icon, label } = config[status]
  
  return (
    <div className={cn(
      'inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium transition-all',
      bgClass,
      className
    )}>
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Icon className="w-4 h-4" />
      )}
      <span>{label}</span>
      {retryCount > 0 && (
        <span className="text-xs bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded">
          Retry {retryCount}
        </span>
      )}
    </div>
  )
}