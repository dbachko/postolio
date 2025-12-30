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

export function ReplyBox({
  onSendMessage,
  brandId,
  disabled = false,
  placeholder = 'Type your message...',
  maxLength = 1000,
}: ReplyBoxProps) {
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea as content grows
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [message]);

  // Fetch saved replies for the brand
  const { data: savedRepliesData } = useQuery({
    queryKey: ['saved-replies', brandId],
    queryFn: () => savedReplies.listSavedReplies(brandId),
    enabled: !!brandId && !disabled,
  });

  const replies = savedRepliesData?.savedReplies || [];

  const handleSend = async () => {
    if (!message.trim() || isSending) return;

    try {
      setIsSending(true);
      await onSendMessage(message.trim());
      setMessage(''); // Clear input on success
    } catch (error) {
      // Error is handled by parent component
      console.error('Failed to send message:', error);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Send on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInsert = (text: string) => {
    if (!textareaRef.current) return;

    const textarea = textareaRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    // Insert text at cursor position
    const newValue = message.substring(0, start) + text + message.substring(end);

    // Check if new value exceeds max length
    if (newValue.length <= maxLength) {
      setMessage(newValue);

      // Set cursor position after inserted text
      setTimeout(() => {
        textarea.focus();
        const newPosition = start + text.length;
        textarea.setSelectionRange(newPosition, newPosition);
      }, 0);
    }
  };

  const handleSelectSavedReply = (reply: SavedReply) => {
    setMessage(reply.body);
  };

  const canSend = message.trim().length > 0 && message.length <= maxLength && !disabled;

  return (
    <div className="border-t">
      {/* Input area with textarea and send button */}
      <div className="flex items-end gap-2 p-2">
        <Textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => {
            const newValue = e.target.value;
            if (newValue.length <= maxLength) {
              setMessage(newValue);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || isSending}
          className="max-h-32 min-h-10 flex-1 resize-none border focus-visible:ring-1"
          maxLength={maxLength}
          rows={1}
        />

        {/* Send Button - square, aligned to bottom */}
        <Button
          onClick={handleSend}
          disabled={!canSend || isSending}
          size="icon"
          className="h-10 w-10 shrink-0"
        >
          {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>

      {/* Toolbar footer */}
      <div className="border-border bg-muted/30 flex items-center justify-between gap-1 border-t px-2 py-1">
        <div className="flex items-center gap-1">
          <EmojiPickerButton onEmojiSelect={handleInsert} disabled={disabled || isSending} />
          <Separator orientation="vertical" className="h-5" />
          <HashtagSuggestionsButton
            brandId={brandId}
            onHashtagSelect={(hashtag) => handleInsert(`#${hashtag} `)}
            disabled={disabled || isSending}
          />
          <Separator orientation="vertical" className="h-5" />

          {/* Saved Replies Dropdown */}
          {replies.length > 0 && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={disabled || isSending}
                  >
                    <MessageSquarePlus className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuLabel>Saved Replies</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {replies.map((reply) => (
                    <DropdownMenuItem
                      key={reply.id}
                      onClick={() => handleSelectSavedReply(reply)}
                      className="flex flex-col items-start gap-1"
                    >
                      <span className="font-medium">{reply.title}</span>
                      <span className="text-muted-foreground line-clamp-2 text-xs">
                        {reply.body}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Separator orientation="vertical" className="h-5" />
            </>
          )}
        </div>
        <div className="text-muted-foreground text-xs">
          {message.length}/{maxLength}
        </div>
      </div>
    </div>
  );
}
