import { formatDistanceToNow } from 'date-fns';
import { MessageCircle, Archive, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { DMConversation } from '@/lib/api';

interface ConversationListProps {
  conversations: DMConversation[];
  selectedConversationId?: string;
  onSelectConversation: (conversation: DMConversation) => void;
  onArchiveConversation?: (conversationId: string) => void;
  isLoading?: boolean;
}

export function ConversationList({
  conversations,
  selectedConversationId,
  onSelectConversation,
  onArchiveConversation,
  isLoading = false,
}: ConversationListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-muted-foreground text-sm">Loading conversations...</div>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <MessageCircle className="text-muted-foreground mb-3 h-12 w-12" />
        <p className="text-foreground mb-1 text-sm font-medium">No conversations yet</p>
        <p className="text-muted-foreground text-xs">
          Conversations will appear here when users send you direct messages
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y">
      {conversations.map((conversation) => (
        <ConversationItem
          key={conversation.id}
          conversation={conversation}
          isSelected={conversation.id === selectedConversationId}
          onSelect={() => onSelectConversation(conversation)}
          onArchive={
            onArchiveConversation ? () => onArchiveConversation(conversation.id) : undefined
          }
        />
      ))}
    </div>
  );
}

interface ConversationItemProps {
  conversation: DMConversation;
  isSelected: boolean;
  onSelect: () => void;
  onArchive?: () => void;
}

function ConversationItem({
  conversation,
  isSelected,
  onSelect,
  onArchive,
}: ConversationItemProps) {
  const isAutomated = !!conversation.rule;
  const lastMessageTime = conversation.lastMessage?.createdAt
    ? formatDistanceToNow(new Date(conversation.lastMessage.createdAt), { addSuffix: true })
    : formatDistanceToNow(new Date(conversation.lastMessageAt), { addSuffix: true });

  return (
    <div
      className={cn(
        'hover:bg-accent group relative flex cursor-pointer gap-3 p-4 transition-colors',
        isSelected && 'bg-accent'
      )}
      onClick={onSelect}
    >
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-foreground truncate font-medium">
              @{conversation.instagramUsername}
            </span>
            {isAutomated && (
              <Badge variant="secondary" className="shrink-0 text-xs">
                Auto
              </Badge>
            )}
          </div>
          <span className="text-muted-foreground shrink-0 text-xs">{lastMessageTime}</span>
        </div>

        {conversation.lastMessage && (
          <p className="text-muted-foreground line-clamp-2 text-sm">
            {conversation.lastMessage.direction === 'outbound' && 'You: '}
            {conversation.lastMessage.text}
          </p>
        )}

        {isAutomated && conversation.rule && (
          <div className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
            <MessageCircle className="h-3 w-3" />
            <span>Rule: {conversation.rule.name}</span>
          </div>
        )}

        {conversation.state === 'spam' && (
          <div className="text-destructive mt-1 flex items-center gap-1 text-xs">
            <AlertCircle className="h-3 w-3" />
            <span>Marked as spam</span>
          </div>
        )}
      </div>

      {onArchive && conversation.state === 'active' && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 opacity-0 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onArchive();
          }}
        >
          <Archive className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
