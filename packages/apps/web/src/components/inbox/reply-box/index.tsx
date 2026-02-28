import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { Send, Loader2, MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useQuery } from '@tanstack/react-query';
import { savedReplies, type SavedReply } from '@/lib/api';
import { EmojiPickerButton } from '@/components/caption/emoji-picker-button';
import { HashtagSuggestionsButton } from '@/components/caption/hashtag-suggestions-button';

interface ReplyBoxProps {
  onSendMessage: (message: string) => Promise<void>;
  brandId: string;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
}

function insertTextAtCursor({
  message,
  text,
  textarea,
}: {
  message: string;
  text: string;
  textarea: HTMLTextAreaElement;
}) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const nextValue = message.substring(0, start) + text + message.substring(end);
  const nextCursorPosition = start + text.length;
  return { nextCursorPosition, nextValue };
}

function useSavedRepliesData({ brandId, disabled }: { brandId: string; disabled: boolean }) {
  const { data } = useQuery({
    queryKey: ['saved-replies', brandId],
    queryFn: () => savedReplies.listSavedReplies(brandId),
    enabled: !!brandId && !disabled,
  });
  return data?.savedReplies || [];
}

function useReplyInputState({
  maxLength,
  onSendMessage,
}: {
  maxLength: number;
  onSendMessage: (message: string) => Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [message]);

  const setMessageWithinLimit = (nextValue: string) => {
    if (nextValue.length <= maxLength) {
      setMessage(nextValue);
    }
  };

  const handleSend = async () => {
    if (!message.trim() || isSending) {
      return;
    }
    try {
      setIsSending(true);
      await onSendMessage(message.trim());
      setMessage('');
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsSending(false);
    }
  };

  const handleInsert = (text: string) => {
    if (!textareaRef.current) {
      return;
    }
    const textarea = textareaRef.current;
    const { nextValue, nextCursorPosition } = insertTextAtCursor({ message, text, textarea });
    if (nextValue.length > maxLength) {
      return;
    }
    setMessage(nextValue);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCursorPosition, nextCursorPosition);
    }, 0);
  };

  return {
    handleInsert,
    handleSend,
    isSending,
    message,
    setMessage,
    setMessageWithinLimit,
    textareaRef,
  };
}

function SavedRepliesDropdown({
  replies,
  disabled,
  isSending,
  onSelect,
}: {
  replies: SavedReply[];
  disabled: boolean;
  isSending: boolean;
  onSelect: (reply: SavedReply) => void;
}) {
  if (replies.length === 0) {
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={disabled || isSending}>
            <MessageSquarePlus className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Saved Replies</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {replies.map((reply) => (
            <DropdownMenuItem
              key={reply.id}
              onClick={() => onSelect(reply)}
              className="flex flex-col items-start gap-1"
            >
              <span className="font-medium">{reply.title}</span>
              <span className="text-muted-foreground line-clamp-2 text-xs">{reply.body}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Separator orientation="vertical" className="h-5" />
    </>
  );
}

function ReplyToolbar({
  disabled,
  isSending,
  brandId,
  replies,
  onInsert,
  onSelectSavedReply,
  messageLength,
  maxLength,
}: {
  disabled: boolean;
  isSending: boolean;
  brandId: string;
  replies: SavedReply[];
  onInsert: (text: string) => void;
  onSelectSavedReply: (reply: SavedReply) => void;
  messageLength: number;
  maxLength: number;
}) {
  return (
    <div className="border-border bg-muted/30 flex items-center justify-between gap-1 border-t px-2 py-1">
      <div className="flex items-center gap-1">
        <EmojiPickerButton onEmojiSelect={onInsert} disabled={disabled || isSending} />
        <Separator orientation="vertical" className="h-5" />
        <HashtagSuggestionsButton
          brandId={brandId}
          onHashtagSelect={(hashtag) => onInsert(`#${hashtag} `)}
          disabled={disabled || isSending}
        />
        <Separator orientation="vertical" className="h-5" />
        <SavedRepliesDropdown
          replies={replies}
          disabled={disabled}
          isSending={isSending}
          onSelect={onSelectSavedReply}
        />
      </div>
      <div className="text-muted-foreground text-xs">
        {messageLength}/{maxLength}
      </div>
    </div>
  );
}

export function ReplyBox({
  onSendMessage,
  brandId,
  disabled = false,
  placeholder = 'Type your message...',
  maxLength = 1000,
}: ReplyBoxProps) {
  const {
    handleInsert,
    handleSend,
    isSending,
    message,
    setMessage,
    setMessageWithinLimit,
    textareaRef,
  } = useReplyInputState({ maxLength, onSendMessage });
  const replies = useSavedRepliesData({ brandId, disabled });

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSelectSavedReply = (reply: SavedReply) => {
    setMessage(reply.body);
  };

  const canSend = message.trim().length > 0 && message.length <= maxLength && !disabled;

  return (
    <div className="border-t">
      <div className="flex items-end gap-2 p-2">
        <Textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessageWithinLimit(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || isSending}
          className="max-h-32 min-h-10 flex-1 resize-none border focus-visible:ring-1"
          maxLength={maxLength}
          rows={1}
        />

        <Button
          onClick={handleSend}
          disabled={!canSend || isSending}
          size="icon"
          className="h-10 w-10 shrink-0"
        >
          {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>

      <ReplyToolbar
        disabled={disabled}
        isSending={isSending}
        brandId={brandId}
        replies={replies}
        onInsert={handleInsert}
        onSelectSavedReply={handleSelectSavedReply}
        messageLength={message.length}
        maxLength={maxLength}
      />
    </div>
  );
}
