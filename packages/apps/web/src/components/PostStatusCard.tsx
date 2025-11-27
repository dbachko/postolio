import { format } from 'date-fns';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { PostStatusBadge } from './PostStatusBadge';

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
  const formattedDate =
    typeof createdAt === 'string'
      ? format(new Date(createdAt), "MMM d, yyyy 'at' h:mm a")
      : format(createdAt, "MMM d, yyyy 'at' h:mm a");

  return (
    <div className={`bg-muted rounded-lg p-4 ${className}`}>
      <div className="text-foreground mb-2 text-sm font-medium">Post Status</div>
      <div className="flex items-center gap-2">
        <PostStatusBadge
          status={status}
          generationParams={
            processing
              ? {
                  processing: {
                    active: true,
                    operation: 'scheduling',
                    startedAt: new Date().toISOString(),
                  },
                }
              : undefined
          }
          schedulingError={errorMessage}
        />
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
