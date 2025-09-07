import { format } from 'date-fns'
import { Badge } from './ui/badge'

export type PostStatus = 'draft' | 'scheduled' | 'published' | 'failed' | 'skipped'

interface PostStatusCardProps {
  status: PostStatus
  createdAt: string | Date
  className?: string
}

export function PostStatusCard({ status, createdAt, className = '' }: PostStatusCardProps) {
  const getBadgeVariant = (status: PostStatus) => {
    switch (status) {
      case 'draft':
        return 'secondary'
      case 'scheduled':
        return 'default'
      case 'published':
        return 'secondary'
      case 'failed':
        return 'destructive'
      case 'skipped':
        return 'outline'
      default:
        return 'secondary'
    }
  }

  const formattedDate = typeof createdAt === 'string' 
    ? format(new Date(createdAt), 'MMM d, yyyy \'at\' h:mm a')
    : format(createdAt, 'MMM d, yyyy \'at\' h:mm a')

  return (
    <div className={`bg-gray-50 rounded-lg p-4 ${className}`}>
      <div className="text-sm font-medium text-gray-700 mb-2">Post Status</div>
      <div className="flex items-center gap-2">
        <Badge variant={getBadgeVariant(status)}>
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </Badge>
        <span className="text-xs text-gray-500">
          Created: {formattedDate}
        </span>
      </div>
    </div>
  )
}