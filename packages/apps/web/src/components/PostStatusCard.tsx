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
  firstComment?: string | null;
  firstCommentStatus?: 'pending' | 'posted' | 'failed' | 'retrying' | null;
  firstCommentError?: string | null;
}

export function PostStatusCard({
  status,
  createdAt,
  className = '',
  processing = false,
  errorMessage,
  firstComment,
  firstCommentStatus,
  firstCommentError,
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

      {/* First Comment Status */}
      {status === 'published' && firstComment && (
        <div className="border-border mt-3 border-t pt-3">
          <div className="mb-1 text-sm font-medium">First Comment</div>
          {firstCommentStatus === 'posted' && (
            <div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-500">
              <span className="text-base">✅</span>
              <span>Posted successfully</span>
            </div>
          )}
          {firstCommentStatus === 'failed' && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-500">
                <span className="text-base">⚠️</span>
                <span>Failed to post</span>
              </div>
              {firstCommentError && (
                <div className="text-muted-foreground mt-1 ml-6 text-xs">{firstCommentError}</div>
              )}
            </div>
          )}
          {firstCommentStatus === 'retrying' && (
            <div className="flex items-center gap-1.5 text-sm text-yellow-600 dark:text-yellow-500">
              <span className="text-base">🔄</span>
              <span>Retrying...</span>
            </div>
          )}
          {firstCommentStatus === 'pending' && (
            <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <span className="text-base">⏳</span>
              <span>Pending</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
