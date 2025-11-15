import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Loader2 } from 'lucide-react';

export type PostStatus = 'draft' | 'scheduled' | 'published' | 'failed' | 'skipped';

interface PostStatusCardProps {
  status: PostStatus;
  createdAt: string | Date;
  className?: string;
  processing?: boolean;
  errorMessage?: string | null;
}

export function PostStatusCard({
  status,
  createdAt,
  className = '',
  processing = false,
  errorMessage,
}: PostStatusCardProps) {
  const getBadgeVariant = (status: PostStatus) => {
    switch (status) {
      case 'draft':
        return 'secondary';
      case 'scheduled':
        return 'default';
      case 'published':
        return 'secondary';
      case 'failed':
        return 'destructive';
      case 'skipped':
        return 'outline';
      default:
        return 'secondary';
    }
  };

  const formattedDate =
    typeof createdAt === 'string'
      ? format(new Date(createdAt), "MMM d, yyyy 'at' h:mm a")
      : format(createdAt, "MMM d, yyyy 'at' h:mm a");

  return (
    <div className={`bg-muted rounded-lg p-4 ${className}`}>
      <div className="text-foreground mb-2 text-sm font-medium">Post Status</div>
      <div className="flex items-center gap-2">
        {processing ? (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> Scheduling...
          </Badge>
        ) : (
          <Badge variant={getBadgeVariant(status)}>
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </Badge>
        )}
        <span className="text-muted-foreground text-xs">Created: {formattedDate}</span>
      </div>
      {status === 'failed' && errorMessage ? (
        <Alert variant="destructive" className="mt-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Publishing failed</AlertTitle>
          <AlertDescription className="text-sm leading-relaxed break-all whitespace-pre-line">
            {errorMessage}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
