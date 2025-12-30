import { CheckCircle, Trash2 } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

type PostActionsCardProps = {
  isPosted: boolean;
  isMultiDestinationGroup: boolean;
  postStatus: string;
  publishPending: boolean;
  deletePending: boolean;
  onPublishNow: () => void;
  onDelete: () => void;
};

export function PostActionsCard({
  isPosted,
  isMultiDestinationGroup,
  postStatus,
  publishPending,
  deletePending,
  onPublishNow,
  onDelete,
}: PostActionsCardProps) {
  return (
    <Card className="p-4 md:p-6">
      <h3 className="mb-3 text-base font-semibold md:mb-4 md:text-lg">Actions</h3>
      <div className="space-y-2">
        {!isPosted ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button className="w-full" variant="outline" disabled={publishPending}>
                <CheckCircle className="mr-2 h-4 w-4" />
                {isMultiDestinationGroup ? 'Publish All Destinations' : 'Publish Now'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {isMultiDestinationGroup
                    ? 'Publish all destinations now?'
                    : 'Publish this post now?'}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This will publish immediately
                  {postStatus === 'scheduled' ? ' and override the scheduled time' : ''}.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={publishPending}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onPublishNow} disabled={publishPending}>
                  {isMultiDestinationGroup ? 'Publish All' : 'Publish Now'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button className="w-full" variant="destructive" disabled={deletePending}>
              <Trash2 className="mr-2 h-4 w-4" />
              {isMultiDestinationGroup ? 'Delete Post Group' : 'Delete Post'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {isMultiDestinationGroup ? 'Delete this post group?' : 'Delete this post?'}
              </AlertDialogTitle>
              <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletePending}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete} disabled={deletePending}>
                Delete Post
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Card>
  );
}
