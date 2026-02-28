import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { QuickLensChips } from '@/components/quick-lens-chips';
import { ProfileAvatar } from '@/components/ui/profile-avatar';
import { Heart, CheckCircle2, Archive, Send, Eraser } from 'lucide-react';
import type { CommentRow } from './types';

type CommentCardProps = {
  data: CommentRow;
  isReplying: boolean;
  isSending?: boolean;
  replyText: string;
  setReplyText: (v: string) => void;
  onStartReply: () => void;
  onCancelReply: () => void;
  onSendReply: () => void;
  onLike: () => void;
  onResolve: () => void;
  onArchive: () => void;
  savedReplies?: Array<{ id: string; title: string; body: string }>;
  onSaveReply?: (title: string, body: string) => Promise<void> | void;
};

function SavedReplyButtons({
  savedReplies,
  replyText,
  setReplyText,
}: {
  savedReplies: Array<{ id: string; title: string; body: string }>;
  replyText: string;
  setReplyText: (v: string) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {savedReplies.slice(0, 5).map((reply) => (
        <Button
          key={reply.id}
          size="sm"
          variant="secondary"
          onClick={() => setReplyText(replyText ? `${replyText} ${reply.body}` : reply.body)}
        >
          {reply.title}
        </Button>
      ))}
    </div>
  );
}

function ReplyComposer({
  data,
  isSending,
  replyText,
  setReplyText,
  onCancelReply,
  onSendReply,
  savedReplies,
  onSaveReply,
}: Pick<
  CommentCardProps,
  | 'data'
  | 'isSending'
  | 'replyText'
  | 'setReplyText'
  | 'onCancelReply'
  | 'onSendReply'
  | 'savedReplies'
  | 'onSaveReply'
>) {
  return (
    <div className="bg-muted/30 mt-3 rounded-md border p-2">
      <Textarea
        value={replyText}
        onChange={(e) => setReplyText(e.target.value)}
        placeholder={`Reply to ${data.username || 'user'}…`}
        className="min-h-[80px]"
        onKeyDown={(e) => {
          if (!isSending && (e.metaKey || e.ctrlKey) && e.key === 'Enter' && replyText.trim()) {
            e.preventDefault();
            onSendReply();
          }
        }}
      />
      {(savedReplies?.length ?? 0) > 0 ? (
        <SavedReplyButtons
          savedReplies={savedReplies || []}
          replyText={replyText}
          setReplyText={setReplyText}
        />
      ) : null}
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        <Button size="sm" onClick={onSendReply} disabled={isSending || !replyText.trim()}>
          <Send className="mr-1 h-4 w-4" /> Send
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancelReply}>
          Cancel
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setReplyText('')}
          disabled={isSending || !replyText.trim()}
          title="Clear input"
        >
          <Eraser className="mr-1 h-4 w-4" /> Clear
        </Button>
        {onSaveReply ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={!replyText.trim()}
            onClick={() =>
              onSaveReply(replyText.slice(0, 30) + (replyText.length > 30 ? '…' : ''), replyText)
            }
          >
            Save as reply
          </Button>
        ) : null}
      </div>
      <div className="text-muted-foreground mt-1 text-[10px]">Press ⌘⏎ / Ctrl⏎ to send</div>
    </div>
  );
}

export function CommentCard({
  data,
  isReplying,
  isSending = false,
  replyText,
  setReplyText,
  onStartReply,
  onCancelReply,
  onSendReply,
  onLike,
  onResolve,
  onArchive,
  savedReplies,
  onSaveReply,
}: CommentCardProps) {
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ProfileAvatar name={data.username || 'User'} size="sm" />
          <div className="text-foreground font-medium">{data.username || 'User'}</div>
          {Boolean(data?.workflow?.status) && (
            <span className="text-muted-foreground text-xs capitalize">
              {data?.workflow?.status}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-8 w-8" title="Like" onClick={onLike}>
            <Heart className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            title="Mark as read"
            onClick={onResolve}
          >
            <CheckCircle2 className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            title="Archive"
            onClick={onArchive}
          >
            <Archive className="h-4 w-4" />
          </Button>
          {!isReplying && (
            <Button variant="secondary" size="sm" onClick={onStartReply} className="ml-1">
              Reply
            </Button>
          )}
        </div>
      </div>
      <div className="text-sm whitespace-pre-wrap">{data.text}</div>
      <div className="mt-2">
        <QuickLensChips text={data.text || ''} />
      </div>
      {/* Meta row */}
      <div className="text-muted-foreground mt-3 flex items-center gap-2 text-xs">
        <div>{data.timestamp ? new Date(data.timestamp).toLocaleString() : ''}</div>
      </div>

      {isReplying ? (
        <ReplyComposer
          data={data}
          isSending={isSending}
          replyText={replyText}
          setReplyText={setReplyText}
          onCancelReply={onCancelReply}
          onSendReply={onSendReply}
          savedReplies={savedReplies}
          onSaveReply={onSaveReply}
        />
      ) : null}
    </div>
  );
}
