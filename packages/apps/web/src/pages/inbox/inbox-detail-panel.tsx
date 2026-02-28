import { Archive, CheckCheck, Inbox as InboxIcon, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { CommentCard } from '@/components/inbox/comment-card';
import { MessageThread } from '@/components/inbox/message-thread';
import { ReplyBox } from '@/components/inbox/reply-box';

import type { useInboxPageModel } from './use-inbox-page-model';

type InboxPageModel = ReturnType<typeof useInboxPageModel>;

type DetailPanelProps = Pick<
  InboxPageModel,
  | 'selectedItem'
  | 'messages'
  | 'messagesLoading'
  | 'sendMessageMutation'
  | 'brandId'
  | 'archiveConversationMutation'
  | 'selectedPublicationId'
  | 'refreshCommentsMutation'
  | 'refreshSelectedThread'
  | 'markAllRead'
  | 'commentsData'
  | 'commentsFetching'
  | 'selectedPreviewUrl'
  | 'activeReplyFor'
  | 'replyMutation'
  | 'replyText'
  | 'setReplyText'
  | 'setActiveReplyFor'
  | 'likeMutation'
  | 'workflowMutation'
  | 'repliesData'
  | 'saveReply'
>;

function EmptyDetail() {
  return (
    <CardContent className="flex flex-1 items-center justify-center">
      <div className="text-muted-foreground text-center">
        <InboxIcon className="mx-auto mb-3 h-12 w-12" />
        <p className="text-sm font-medium">Select an item</p>
        <p className="text-xs">Choose an item from the list to view details</p>
      </div>
    </CardContent>
  );
}

function DMDetail({ model }: { model: DetailPanelProps }) {
  const selectedItem = model.selectedItem;
  if (selectedItem?.type !== 'dm_conversation') {
    return null;
  }

  let placeholder = 'Type your message...';
  if (selectedItem.state === 'archived') {
    placeholder = 'Cannot reply to archived conversation';
  } else if (selectedItem.state === 'spam') {
    placeholder = 'Cannot reply to spam conversation';
  }

  return (
    <>
      <CardHeader className="border-b">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate">{selectedItem.participantUsername}</CardTitle>
            <p className="text-muted-foreground mt-1 text-sm">
              {selectedItem.lastMessageDirection === 'inbound' ? 'Inbound message' : 'Conversation'}
            </p>
          </div>
          {selectedItem.state === 'active' ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => model.archiveConversationMutation.mutate(selectedItem.conversationId)}
              disabled={model.archiveConversationMutation.isPending}
            >
              <Archive className="mr-2 h-4 w-4" />
              Archive
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col p-0">
        <MessageThread messages={model.messages} isLoading={model.messagesLoading} />
        <ReplyBox
          onSendMessage={async (messageText) => {
            await model.sendMessageMutation.mutateAsync(messageText);
          }}
          brandId={model.brandId!}
          disabled={selectedItem.state !== 'active'}
          placeholder={placeholder}
        />
      </CardContent>
    </>
  );
}

function CommentList({ model }: { model: DetailPanelProps }) {
  if (!model.commentsData?.data?.length) {
    return <div className="text-muted-foreground text-sm">No comments found.</div>;
  }

  return (
    <div className="space-y-4">
      {model.commentsData.data.map((comment) => (
        <CommentCard
          key={comment.id}
          data={comment as any}
          isReplying={model.activeReplyFor === comment.id}
          isSending={model.replyMutation.isPending}
          replyText={model.replyText}
          setReplyText={model.setReplyText}
          onStartReply={() => model.setActiveReplyFor(comment.id || null)}
          onCancelReply={() => model.setActiveReplyFor(null)}
          onSendReply={() => handleSendReply(model, comment.id || null)}
          onLike={() => comment.id && model.likeMutation.mutate({ commentId: comment.id })}
          onResolve={() =>
            comment.id &&
            model.workflowMutation.mutate({ commentId: comment.id, status: 'resolved' })
          }
          onArchive={() =>
            comment.id &&
            model.workflowMutation.mutate({ commentId: comment.id, status: 'archived' })
          }
          savedReplies={model.repliesData?.savedReplies || []}
          onSaveReply={model.saveReply}
        />
      ))}
    </div>
  );
}

function handleSendReply(model: DetailPanelProps, commentId: string | null) {
  if (model.replyMutation.isPending || !commentId) {
    return;
  }
  const message = model.replyText.trim();
  if (!message) {
    return;
  }
  model.replyMutation.mutate({ commentId, message });
}

function CommentDetail({ model }: { model: DetailPanelProps }) {
  if (model.selectedItem?.type !== 'comment_thread') {
    return null;
  }

  return (
    <>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate">Comments</CardTitle>
            <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-sm">
              <span className="truncate">
                {model.selectedItem.previewAuthorUsername
                  ? `@${model.selectedItem.previewAuthorUsername}`
                  : 'Thread'}
              </span>
              {model.selectedItem.permalink ? (
                <a
                  href={model.selectedItem.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground hover:text-foreground underline"
                >
                  View on Instagram
                </a>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={model.refreshSelectedThread}
              disabled={!model.selectedPublicationId || model.refreshCommentsMutation.isPending}
            >
              <RotateCw className="mr-1 h-4 w-4" /> Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={model.markAllRead}
              disabled={!model.commentsData?.data?.length}
            >
              <CheckCheck className="mr-1 h-4 w-4" /> Mark all read
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4 overflow-hidden p-4">
        <div className="flex items-center gap-3">
          {model.selectedPreviewUrl ? (
            <img src={model.selectedPreviewUrl} alt="" className="h-14 w-14 rounded object-cover" />
          ) : (
            <div className="bg-muted h-14 w-14 rounded" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-foreground line-clamp-2 text-sm">
              {model.selectedItem.caption || '—'}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full pr-2">
            {model.commentsFetching ? <CommentSkeleton /> : <CommentList model={model} />}
          </ScrollArea>
        </div>
      </CardContent>
    </>
  );
}

function CommentSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="rounded-md border p-2">
          <Skeleton className="mb-2 h-3 w-1/3" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      ))}
    </div>
  );
}

export function InboxDetailPanel({ model }: { model: DetailPanelProps }) {
  return (
    <Card className="flex flex-col lg:col-span-5">
      {!model.selectedItem ? <EmptyDetail /> : null}
      {model.selectedItem?.type === 'dm_conversation' ? <DMDetail model={model} /> : null}
      {model.selectedItem?.type === 'comment_thread' ? <CommentDetail model={model} /> : null}
    </Card>
  );
}
