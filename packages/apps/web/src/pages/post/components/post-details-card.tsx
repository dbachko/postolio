import type { ReactNode } from 'react';
import { format } from 'date-fns';
import { AlertCircle } from 'lucide-react';

import type { PostDetailData } from '@/hooks/usePostDetail';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PostStatusBadge } from '@/components/post-status-badge';

type PostDetailsCardProps = {
  post: PostDetailData;
  isPosted: boolean;
  publicationButtons: ReactNode[];
};

export function PostDetailsCard({ post, isPosted, publicationButtons }: PostDetailsCardProps) {
  return (
    <Card className="p-4 md:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold md:text-lg">
            {isPosted ? 'Post Details' : 'Post Editor'}
          </h3>
          <div className="text-muted-foreground mt-1 text-xs">
            Created {format(new Date(post.createdAt || Date.now()), 'MMM d, yyyy')}
          </div>
        </div>
        <PostStatusBadge
          status={post.status as any}
          generationParams={post.generationParams as any}
          schedulingError={post.schedulingError || null}
          scheduledAt={post.scheduledAt || undefined}
          className="shrink-0"
        />
      </div>

      {post.status === 'failed' && post.schedulingError ? (
        <Alert variant="destructive" className="mt-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{post.schedulingError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-4 space-y-2">
        {publicationButtons.length ? <div className="space-y-2">{publicationButtons}</div> : null}
      </div>
    </Card>
  );
}
