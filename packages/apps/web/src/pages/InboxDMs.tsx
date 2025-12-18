import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Archive, Inbox, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { dmAutomation, type DMConversation, type ConversationState } from '@/lib/api';
import { useBrandStore } from '@/stores/brandStore';
import { ConversationList } from '@/components/inbox/ConversationList';
import { MessageThread } from '@/components/inbox/MessageThread';
import { ReplyBox } from '@/components/inbox/ReplyBox';
import type { WebSocketMessage } from '@/types/websocket';

export default function InboxDMs() {
  const selectedBrand = useBrandStore((state) => state.selectedBrand);
  const [selectedConversation, setSelectedConversation] = useState<DMConversation | null>(null);
  const [activeTab, setActiveTab] = useState<ConversationState>('active');
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // WebSocket connection for real-time DM updates
  const connectWebSocket = useCallback(() => {
    if (!selectedBrand?.id || wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[DM WebSocket] Connected');
        // Subscribe to brand room for DM events
        ws.send(JSON.stringify({ type: 'subscribe', brandId: selectedBrand.id }));
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);

          // Handle DM message event
          if (message.type === 'dm_message') {
            console.log('[DM WebSocket] New message:', message);
            // Invalidate conversations list to show new message preview
            queryClient.invalidateQueries({
              queryKey: ['dm-conversations', selectedBrand.id],
            });
            // If the message is for the currently selected conversation, invalidate messages too
            if (message.conversationId === selectedConversation?.id) {
              queryClient.invalidateQueries({
                queryKey: ['dm-messages', selectedBrand.id, message.conversationId],
              });
            }
          }

          // Handle conversation update event
          if (message.type === 'dm_conversation_update') {
            console.log('[DM WebSocket] Conversation updated:', message);
            // Invalidate conversations list to reflect state change
            queryClient.invalidateQueries({
              queryKey: ['dm-conversations', selectedBrand.id],
            });
          }
        } catch (error) {
          console.error('[DM WebSocket] Failed to parse message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('[DM WebSocket] Error:', error);
      };

      ws.onclose = () => {
        console.log('[DM WebSocket] Disconnected');
        wsRef.current = null;
        // Attempt reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          if (selectedBrand?.id) {
            connectWebSocket();
          }
        }, 3000);
      };
    } catch (error) {
      console.error('[DM WebSocket] Connection failed:', error);
    }
  }, [selectedBrand?.id, selectedConversation?.id, queryClient]);

  // Connect WebSocket when component mounts or brand changes
  useEffect(() => {
    if (selectedBrand?.id) {
      connectWebSocket();
    }

    // Cleanup on unmount or brand change
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [selectedBrand?.id, connectWebSocket]);

  // Fetch conversations for active tab
  const { data: conversationsData, isLoading: conversationsLoading } = useQuery({
    queryKey: ['dm-conversations', selectedBrand?.id, activeTab],
    queryFn: () => dmAutomation.listConversations(selectedBrand!.id, activeTab),
    enabled: !!selectedBrand,
  });

  const conversations = conversationsData?.conversations || [];

  // Fetch messages for selected conversation
  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ['dm-messages', selectedBrand?.id, selectedConversation?.id],
    queryFn: () =>
      dmAutomation.getConversationMessages(selectedBrand!.id, selectedConversation!.id),
    enabled: !!selectedBrand && !!selectedConversation,
  });

  const messages = messagesData?.messages || [];

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: (messageText: string) =>
      dmAutomation.sendMessage(selectedBrand!.id, selectedConversation!.id, messageText),
    onSuccess: () => {
      // Refresh messages
      queryClient.invalidateQueries({
        queryKey: ['dm-messages', selectedBrand?.id, selectedConversation?.id],
      });
      // Refresh conversations to update last message
      queryClient.invalidateQueries({
        queryKey: ['dm-conversations', selectedBrand?.id],
      });
      toast.success('Message sent');
    },
    onError: () => {
      toast.error('Failed to send message');
    },
  });

  // Archive conversation mutation
  const archiveConversationMutation = useMutation({
    mutationFn: (conversationId: string) =>
      dmAutomation.updateConversationState(selectedBrand!.id, conversationId, 'archived'),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['dm-conversations', selectedBrand?.id],
      });
      toast.success('Conversation archived');
      // Clear selection if archived conversation was selected
      if (selectedConversation?.id === selectedConversation?.id) {
        setSelectedConversation(null);
      }
    },
    onError: () => {
      toast.error('Failed to archive conversation');
    },
  });

  const handleTabChange = (value: string) => {
    setActiveTab(value as ConversationState);
    setSelectedConversation(null); // Clear selection when changing tabs
  };

  const handleSelectConversation = (conversation: DMConversation) => {
    setSelectedConversation(conversation);
  };

  const handleArchiveConversation = (conversationId: string) => {
    archiveConversationMutation.mutate(conversationId);
  };

  const handleSendMessage = async (messageText: string) => {
    await sendMessageMutation.mutateAsync(messageText);
  };

  if (!selectedBrand) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Direct Messages</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground flex items-center justify-center p-8 text-center">
            Please select a brand to view direct messages
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid h-full grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Conversations List */}
      <Card className="lg:col-span-1">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <Inbox className="h-5 w-5" />
            Conversations
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <div className="border-b px-4 py-2">
              <TabsList className="w-full">
                <TabsTrigger value="active" className="flex-1">
                  <Inbox className="mr-2 h-4 w-4" />
                  Active
                </TabsTrigger>
                <TabsTrigger value="archived" className="flex-1">
                  <Archive className="mr-2 h-4 w-4" />
                  Archived
                </TabsTrigger>
                <TabsTrigger value="spam" className="flex-1">
                  <AlertCircle className="mr-2 h-4 w-4" />
                  Spam
                </TabsTrigger>
              </TabsList>
            </div>
          </Tabs>

          <div className="max-h-[calc(100vh-16rem)] overflow-y-auto">
            <ConversationList
              conversations={conversations}
              selectedConversationId={selectedConversation?.id}
              onSelectConversation={handleSelectConversation}
              onArchiveConversation={activeTab === 'active' ? handleArchiveConversation : undefined}
              isLoading={conversationsLoading}
            />
          </div>
        </CardContent>
      </Card>

      {/* Message Thread */}
      <Card className="flex flex-col lg:col-span-2">
        {selectedConversation ? (
          <>
            <CardHeader className="border-b">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>@{selectedConversation.instagramUsername}</CardTitle>
                  {selectedConversation.rule && (
                    <p className="text-muted-foreground mt-1 text-sm">
                      Automated via: {selectedConversation.rule.name}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  {selectedConversation.state === 'active' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleArchiveConversation(selectedConversation.id)}
                    >
                      <Archive className="mr-2 h-4 w-4" />
                      Archive
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>

            <CardContent className="flex flex-1 flex-col p-0">
              <MessageThread messages={messages} isLoading={messagesLoading} />

              <ReplyBox
                onSendMessage={handleSendMessage}
                brandId={selectedBrand.id}
                disabled={selectedConversation.state !== 'active'}
                placeholder={(() => {
                  if (selectedConversation.state === 'archived') {
                    return 'Cannot reply to archived conversation';
                  }
                  if (selectedConversation.state === 'spam') {
                    return 'Cannot reply to spam conversation';
                  }
                  return 'Type your message...';
                })()}
              />
            </CardContent>
          </>
        ) : (
          <CardContent className="flex flex-1 items-center justify-center">
            <div className="text-muted-foreground text-center">
              <Inbox className="mx-auto mb-3 h-12 w-12" />
              <p className="text-sm font-medium">Select a conversation</p>
              <p className="text-xs">Choose a conversation from the list to view messages</p>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
