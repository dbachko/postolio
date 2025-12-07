import { useEffect, useRef } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DMMessage } from '@/lib/api';

interface MessageThreadProps {
  messages: DMMessage[];
  isLoading?: boolean;
}

export function MessageThread({ messages, isLoading = false }: MessageThreadProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-muted-foreground text-sm">Loading messages...</div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex items-center justify-center p-8 text-center">
        <p className="text-muted-foreground text-sm">No messages in this conversation yet</p>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-4">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
}

interface MessageBubbleProps {
  message: DMMessage;
}

function MessageBubble({ message }: MessageBubbleProps) {
  const isOutbound = message.direction === 'outbound';
  const timestamp = message.sentAt || message.createdAt;
  const timeAgo = formatDistanceToNow(new Date(timestamp), { addSuffix: true });

  return (
    <div className={cn('flex', isOutbound ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[70%] space-y-1', isOutbound ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'rounded-2xl px-4 py-2',
            isOutbound ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          )}
        >
          <p className="text-sm break-words whitespace-pre-wrap">{message.messageText}</p>
        </div>

        <div
          className={cn(
            'text-muted-foreground flex items-center gap-1 px-2 text-xs',
            isOutbound && 'justify-end'
          )}
        >
          <span>{timeAgo}</span>
          {isOutbound && message.status === 'failed' && (
            <div className="text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              <span>Failed</span>
            </div>
          )}
        </div>

        {message.status === 'failed' && message.failureReason && (
          <div className="text-destructive px-2 text-xs">{message.failureReason}</div>
        )}
      </div>
    </div>
  );
}
