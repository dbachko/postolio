import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import {
  Archive,
  CheckCheck,
  Inbox as InboxIcon,
  MessageCircle,
  RotateCw,
  Search,
} from 'lucide-react';

import { brand as brandApi, content as contentApi, dmAutomation, savedReplies } from '@/lib/api';
import type { Platform } from '@/lib/platform-config';
import type { ConversationState } from '@/lib/api/types';
import { useBrandStore } from '@/stores/brandStore';
import { useAssetsByIds } from '@/features/assets/hooks/useAssetsByIds';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { SocialAccountAvatar } from '@/components/social/social-account-avatar';
import { CommentCard } from '@/components/inbox/comment-card';
import { MessageThread } from '@/components/inbox/message-thread';
import { ReplyBox } from '@/components/inbox/reply-box';
import type { WebSocketMessage } from '@/types/websocket';

type InboxChannelFilter = 'all' | 'comments' | 'dms';
type InboxPlatformFilter = 'all' | Platform;

type InboxCommentThreadItem = {
  type: 'comment_thread';
  platform: Platform;
  socialAccountId: string;
  publicationId: string;
  postId: string;
  caption: string | null;
  primaryAssetId: string | null;
  permalink: string | null;
  postedAt: string | null;
  totalComments: number;
  resolvedCount: number;
  newCount: number;
  lastActivityAt: string | null;
  previewText: string | null;
  previewAuthorUsername: string | null;
};

type InboxDMConversationItem = {
  type: 'dm_conversation';
  platform: Platform;
  socialAccountId: string;
  conversationId: string;
  state: ConversationState;
  participantUsername: string;
  lastMessageAt: string;
  lastMessageText: string | null;
  lastMessageDirection: 'inbound' | 'outbound' | null;
  messageCount: number;
};

type InboxItem = InboxCommentThreadItem | InboxDMConversationItem;

type CommentItem = { id?: string; text?: string; username?: string; timestamp?: string };

function matchesQuery(value: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return value.toLowerCase().includes(q);
}

export default function Inbox() {
  const brand = useBrandStore((s) => s.selectedBrand);
  const brandId = brand?.id;
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const autoSyncedAccountsRef = useRef<Set<string>>(new Set());

  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [channel, setChannel] = useState<InboxChannelFilter>('all');
  const [platform, setPlatform] = useState<InboxPlatformFilter>('all');
  const [itemQuery, setItemQuery] = useState('');

  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
  const [activeReplyFor, setActiveReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  // Reset state when brand changes.
  useEffect(() => {
    setSelectedAccountId('');
    setChannel('all');
    setPlatform('all');
    setItemQuery('');
    setSelectedItemKey(null);
    setActiveReplyFor(null);
    setReplyText('');
  }, [brandId]);

  const { data: connectedAccountsData } = useQuery({
    queryKey: ['connected-accounts', brandId],
    queryFn: async () => (await brandApi.getConnectedAccounts(brandId!)) as any,
    enabled: Boolean(brandId),
    staleTime: 30_000,
  });

  const socialAccounts = useMemo(() => {
    const accounts = (connectedAccountsData as any)?.socialAccounts || [];
    return (accounts as Array<any>).slice().sort((a, b) => {
      if (a.platform !== b.platform) return String(a.platform).localeCompare(String(b.platform));
      return (a.sortOrder || 0) - (b.sortOrder || 0);
    });
  }, [connectedAccountsData]);

  // Default selection: pick the first connected account.
  useEffect(() => {
    if (!brandId) return;
    if (selectedAccountId) return;
    if (socialAccounts.length === 0) return;
    const firstConnected = socialAccounts.find((account) => !account?.disconnected);
    setSelectedAccountId(String((firstConnected || socialAccounts[0]).id));
  }, [brandId, selectedAccountId, socialAccounts]);

  const socialAccountById = useMemo(() => {
    return new Map(socialAccounts.map((a) => [String(a.id), a]));
  }, [socialAccounts]);

  // Fetch the full Inbox (view=all) once per brand and filter locally for snappy UX.
  // This avoids re-fetching on every account/filter toggle.
  const inboxQueryKey = useMemo(() => ['inbox-items', brandId] as const, [brandId]);

  const {
    data: inboxData,
    isLoading: inboxLoading,
    isError: inboxIsError,
    error: inboxError,
    refetch: refetchInbox,
  } = useQuery({
    queryKey: inboxQueryKey,
    queryFn: async () =>
      (await brandApi.getInboxItems(brandId!, {
        view: 'all',
        limit: 200,
      })) as any,
    enabled: Boolean(brandId),
    staleTime: 10_000,
  });

  const items = useMemo(() => ((inboxData as any)?.items || []) as InboxItem[], [inboxData]);

  const syncInboxMutation = useMutation({
    mutationFn: async (vars: { socialAccountId: string; silent?: boolean }) => {
      if (!brandId) throw new Error('No brand selected');
      const socialAccountId = String(vars.socialAccountId || '').trim();
      if (!socialAccountId) throw new Error('No social account selected');

      const [commentsRes, dmsRes] = await Promise.allSettled([
        brandApi.ingestInboxComments(brandId, {
          socialAccountIds: [socialAccountId],
          sync: true,
          maxPosts: 20,
          perPostLimit: 50,
        }),
        brandApi.ingestInboxDMs(brandId, {
          socialAccountIds: [socialAccountId],
          sync: true,
          maxThreads: 25,
          perThreadLimit: 30,
        }),
      ]);

      const commentsOk = commentsRes.status === 'fulfilled';
      const dmsOk = dmsRes.status === 'fulfilled';
      if (!commentsOk && !dmsOk) {
        const err = commentsRes.status === 'rejected' ? commentsRes.reason : dmsRes.reason;
        throw err instanceof Error ? err : new Error('Failed to sync inbox');
      }
      return { commentsOk, dmsOk };
    },
    onSuccess: async (_data, vars) => {
      await refetchInbox();
      if (!vars.silent) {
        const commentsOk = Boolean((_data as any)?.commentsOk);
        const dmsOk = Boolean((_data as any)?.dmsOk);
        if (commentsOk && dmsOk) toast.success('Inbox synced');
        else if (commentsOk) toast.info('Synced comments. DMs may need additional permissions.');
        else toast.info('Synced DMs. Comments may need additional permissions.');
      }
    },
    onError: (e: any, vars) => {
      autoSyncedAccountsRef.current.delete(String(vars?.socialAccountId || ''));
      if (!vars?.silent) toast.error(e?.message || 'Failed to sync inbox');
    },
  });

  // Auto-sync when switching accounts so inbox shows existing activity (comments + DMs).
  useEffect(() => {
    if (!brandId) return;
    if (!selectedAccountId) return;
    if (autoSyncedAccountsRef.current.has(selectedAccountId)) return;
    autoSyncedAccountsRef.current.add(selectedAccountId);
    syncInboxMutation.mutate({ socialAccountId: selectedAccountId, silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, selectedAccountId]);

  const scopedItems = useMemo(() => {
    let next = items;

    // Channel/type filter
    if (channel === 'comments') next = next.filter((i) => i.type === 'comment_thread');
    if (channel === 'dms') next = next.filter((i) => i.type === 'dm_conversation');

    // Platform filter
    if (platform !== 'all') next = next.filter((i) => i.platform === platform);

    return next;
  }, [channel, items, platform]);

  const filteredItems = useMemo(() => {
    let next = scopedItems;

    // Account filter
    if (selectedAccountId) {
      next = next.filter((item) => item.socialAccountId === selectedAccountId);
    }

    const q = itemQuery.trim().toLowerCase();
    if (!q) return next;
    return next.filter((item) => {
      if (item.type === 'dm_conversation') {
        return (
          matchesQuery(item.participantUsername || '', q) ||
          matchesQuery(item.lastMessageText || '', q)
        );
      }
      return (
        matchesQuery(item.previewAuthorUsername ? `@${item.previewAuthorUsername}` : '', q) ||
        matchesQuery(item.previewText || '', q) ||
        matchesQuery(item.caption || '', q)
      );
    });
  }, [itemQuery, scopedItems, selectedAccountId]);

  const itemCountBySocialAccountId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of scopedItems) {
      const prev = counts.get(item.socialAccountId) || 0;
      counts.set(item.socialAccountId, prev + 1);
    }
    return counts;
  }, [scopedItems]);

  // Default selection to first item in list.
  useEffect(() => {
    if (filteredItems.length === 0) {
      setSelectedItemKey(null);
      return;
    }
    if (!selectedItemKey) {
      const first = filteredItems[0];
      setSelectedItemKey(
        first.type === 'dm_conversation' ? `dm:${first.conversationId}` : `c:${first.publicationId}`
      );
      return;
    }
    const stillExists = filteredItems.some((i) =>
      i.type === 'dm_conversation'
        ? `dm:${i.conversationId}` === selectedItemKey
        : `c:${i.publicationId}` === selectedItemKey
    );
    if (!stillExists) {
      const first = filteredItems[0];
      setSelectedItemKey(
        first.type === 'dm_conversation' ? `dm:${first.conversationId}` : `c:${first.publicationId}`
      );
    }
  }, [filteredItems, selectedItemKey]);

  const selectedItem = useMemo(() => {
    if (!selectedItemKey) return null;
    if (selectedItemKey.startsWith('dm:')) {
      const id = selectedItemKey.slice('dm:'.length);
      return (
        filteredItems.find((i) => i.type === 'dm_conversation' && i.conversationId === id) || null
      );
    }
    if (selectedItemKey.startsWith('c:')) {
      const id = selectedItemKey.slice('c:'.length);
      return (
        filteredItems.find((i) => i.type === 'comment_thread' && i.publicationId === id) || null
      );
    }
    return null;
  }, [filteredItems, selectedItemKey]);

  const selectedAssetId =
    selectedItem?.type === 'comment_thread' ? selectedItem.primaryAssetId : null;
  const { data: selectedAssetsById } = useAssetsByIds([selectedAssetId]);
  const selectedPreviewUrl = useMemo(() => {
    if (!selectedAssetId) return null;
    const asset = selectedAssetsById?.[selectedAssetId] ?? null;
    return asset?.thumbnailUrl || asset?.url || null;
  }, [selectedAssetId, selectedAssetsById]);

  // Saved replies (used for comments quick actions)
  const { data: repliesData } = useQuery<{
    savedReplies: Array<{ id: string; title: string; body: string }>;
  }>({
    queryKey: ['saved-replies', brandId],
    queryFn: async () => (await savedReplies.listSavedReplies(brandId!)) as any,
    enabled: Boolean(brandId),
  });

  // -----------------------
  // DM detail queries/actions
  // -----------------------
  const selectedConversationId =
    selectedItem?.type === 'dm_conversation' ? selectedItem.conversationId : null;

  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ['dm-messages', brandId, selectedConversationId],
    queryFn: () => dmAutomation.getConversationMessages(brandId!, selectedConversationId!),
    enabled: Boolean(brandId && selectedConversationId),
  });

  const messages = (messagesData as any)?.messages || [];

  const sendMessageMutation = useMutation({
    mutationFn: (messageText: string) =>
      dmAutomation.sendMessage(brandId!, selectedConversationId!, messageText),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dm-messages', brandId, selectedConversationId] });
      queryClient.invalidateQueries({ queryKey: ['inbox-items', brandId] });
      toast.success('Message sent');
    },
    onError: () => toast.error('Failed to send message'),
  });

  const archiveConversationMutation = useMutation({
    mutationFn: (conversationId: string) =>
      dmAutomation.updateConversationState(brandId!, conversationId, 'archived'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox-items', brandId] });
      toast.success('Conversation archived');
      setSelectedItemKey(null);
    },
    onError: () => toast.error('Failed to archive conversation'),
  });

  // -----------------------
  // Comments detail queries/actions
  // -----------------------
  const selectedPublicationId =
    selectedItem?.type === 'comment_thread' ? selectedItem.publicationId : null;
  const selectedPostId = selectedItem?.type === 'comment_thread' ? selectedItem.postId : null;

  const {
    data: commentsData,
    refetch: refetchComments,
    isFetching: commentsFetching,
  } = useQuery<{
    data: CommentItem[];
    page: number;
    pageSize: number;
    total: number;
  }>({
    queryKey: ['post-comments', selectedPublicationId],
    queryFn: async () => {
      if (!selectedPostId || !selectedPublicationId) throw new Error('No thread selected');
      return (await contentApi.getPostComments(selectedPostId, 1, 50, {
        publicationId: selectedPublicationId,
      })) as any;
    },
    enabled: Boolean(selectedPostId && selectedPublicationId),
  });

  const replyMutation = useMutation({
    mutationFn: async (vars: { commentId: string; message: string }) => {
      if (!selectedPostId || !selectedPublicationId) throw new Error('No thread selected');
      return contentApi.replyToComment(selectedPostId, vars.commentId, vars.message, {
        publicationId: selectedPublicationId,
      });
    },
    onSuccess: () => {
      toast.success('Replied');
      setReplyText('');
      setActiveReplyFor(null);
      refetchComments();
      refetchInbox();
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to reply'),
  });

  const likeMutation = useMutation({
    mutationFn: async (vars: { commentId: string }) => {
      if (!selectedPostId || !selectedPublicationId) throw new Error('No thread selected');
      return contentApi.likeComment(selectedPostId, vars.commentId, {
        publicationId: selectedPublicationId,
      });
    },
    onSuccess: () => toast.success('Liked'),
    onError: (e: any) => toast.info(e?.message || 'Like not available'),
  });

  const workflowMutation = useMutation({
    mutationFn: async (vars: { commentId: string; status?: 'open' | 'resolved' | 'archived' }) => {
      if (!selectedPostId || !selectedPublicationId) throw new Error('No thread selected');
      return contentApi.setCommentWorkflow(selectedPostId, vars.commentId, vars, {
        publicationId: selectedPublicationId,
      });
    },
    onSuccess: async () => {
      await Promise.all([refetchComments(), refetchInbox()]);
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to update'),
  });

  const refreshCommentsMutation = useMutation({
    mutationFn: async (vars: { postId: string; publicationId: string }) => {
      return (await contentApi.getPostComments(vars.postId, 1, 50, {
        publicationId: vars.publicationId,
        refresh: true,
      })) as any;
    },
    onSuccess: async (data, vars) => {
      queryClient.setQueryData(['post-comments', vars.publicationId], data);
      toast.success('Refreshed');
      await refetchInbox();
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to refresh'),
  });

  const markAllRead = useCallback(async () => {
    const cs = commentsData?.data || [];
    if (!selectedPostId || !selectedPublicationId || !cs.length) return;
    try {
      const ids = cs.map((c) => String(c.id || '')).filter(Boolean);
      await contentApi.markAllCommentsRead(selectedPostId, ids, {
        publicationId: selectedPublicationId,
      });
      toast.success('Marked all as read');
      await Promise.all([refetchComments(), refetchInbox()]);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to mark all as read');
    }
  }, [commentsData?.data, refetchComments, refetchInbox, selectedPostId, selectedPublicationId]);

  const refreshSelectedThread = useCallback(() => {
    if (!selectedPostId || !selectedPublicationId) return;
    refreshCommentsMutation.mutate({
      postId: selectedPostId,
      publicationId: selectedPublicationId,
    });
  }, [refreshCommentsMutation, selectedPostId, selectedPublicationId]);

  const saveReply = useCallback(
    async (title: string, body: string) => {
      if (!brandId) return;
      try {
        await savedReplies.createSavedReply(brandId, { title, body });
        toast.success('Saved reply added');
      } catch (e: any) {
        toast.error(e?.message || 'Failed to save reply');
      }
    },
    [brandId]
  );

  // -----------------------
  // WebSocket for DM updates
  // -----------------------
  const connectWebSocket = useCallback(() => {
    if (!brandId) return;

    const current = wsRef.current;
    if (
      current &&
      (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = undefined;
    }

    // Production: connect via the app host (CloudFront forwards /ws to the API).
    // Development: connect directly to the API server to avoid intermittent proxy issues
    // with WebSocket upgrades in some Node/Vite setups.
    let wsUrl: string;
    if (import.meta.env.DEV) {
      const apiBase = (import.meta.env as any).VITE_API_BASE_URL as string | undefined;
      if (apiBase) {
        try {
          const apiUrl = new URL(apiBase);
          const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
          wsUrl = `${protocol}//${apiUrl.host}/ws`;
        } catch {
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          wsUrl = `${protocol}//${window.location.hostname}:3000/ws`;
        }
      } else {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${protocol}//${window.location.hostname}:3000/ws`;
      }
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${window.location.host}/ws`;
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', brandId }));
    };

    ws.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);
        if (message.type === 'dm_message') {
          queryClient.invalidateQueries({ queryKey: ['inbox-items', brandId] });
          if (message.conversationId) {
            queryClient.invalidateQueries({
              queryKey: ['dm-messages', brandId, message.conversationId],
            });
          }
        }
      } catch {
        // ignore
      }
    };

    ws.onerror = () => {
      // Swallow; `onclose` will handle reconnect logic.
    };

    ws.onclose = (event) => {
      wsRef.current = null;

      // If auth is missing/invalid, the API closes with 1008; avoid infinite reconnect loops.
      if (event.code === 1008) {
        toast.error('WebSocket disconnected: authentication required. Please sign in again.');
        return;
      }

      reconnectTimeoutRef.current = setTimeout(() => {
        connectWebSocket();
      }, 3000);
    };
  }, [brandId, queryClient]);

  useEffect(() => {
    if (!brandId) return;
    connectWebSocket();
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) wsRef.current.close();
      wsRef.current = null;
    };
  }, [brandId, connectWebSocket]);

  if (!brandId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Inbox</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground flex items-center justify-center p-8 text-center">
            Please select a brand to view inbox
          </div>
        </CardContent>
      </Card>
    );
  }

  const renderItemRow = (item: InboxItem) => {
    const isSelected =
      item.type === 'dm_conversation'
        ? selectedItemKey === `dm:${item.conversationId}`
        : selectedItemKey === `c:${item.publicationId}`;

    const account = socialAccountById.get(item.socialAccountId) || null;
    const accountName = account?.displayName || account?.username || 'Account';
    const accountAvatarUrl = account?.profilePictureUrl || null;
    const accountPlatform = (account?.platform || item.platform) as Platform;

    const timeValue =
      item.type === 'dm_conversation'
        ? item.lastMessageAt
        : item.lastActivityAt || item.postedAt || null;

    const timeAgo = timeValue
      ? formatDistanceToNow(new Date(timeValue), { addSuffix: true })
      : null;

    const title =
      item.type === 'dm_conversation'
        ? item.participantUsername
        : item.previewAuthorUsername
          ? `@${item.previewAuthorUsername}`
          : 'Comments';

    const preview =
      item.type === 'dm_conversation'
        ? item.lastMessageText || ''
        : item.previewText || item.caption || '';

    const rowIcon =
      item.type === 'dm_conversation' ? (
        <InboxIcon className="text-muted-foreground h-4 w-4" />
      ) : (
        <MessageCircle className="text-muted-foreground h-4 w-4" />
      );

    const badgeText =
      item.type === 'comment_thread' && item.newCount > 0 ? String(item.newCount) : null;

    return (
      <button
        key={item.type === 'dm_conversation' ? item.conversationId : item.publicationId}
        type="button"
        onClick={() =>
          setSelectedItemKey(
            item.type === 'dm_conversation'
              ? `dm:${item.conversationId}`
              : `c:${item.publicationId}`
          )
        }
        className={cn(
          'w-full rounded-md border p-3 text-left transition-colors',
          isSelected ? 'bg-muted border-border' : 'bg-card hover:bg-muted/50'
        )}
      >
        <div className="flex items-start gap-3">
          <SocialAccountAvatar
            platform={accountPlatform}
            name={accountName}
            src={accountAvatarUrl}
            size="sm"
            selected={isSelected}
            muted={!isSelected}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                {rowIcon}
                <div className="text-foreground truncate text-sm font-medium">{title}</div>
              </div>
              <div className="flex items-center gap-2">
                {badgeText && (
                  <div className="bg-primary text-primary-foreground inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs">
                    {badgeText}
                  </div>
                )}
                {timeAgo && <div className="text-muted-foreground text-xs">{timeAgo}</div>}
              </div>
            </div>
            <div className="text-muted-foreground mt-1 line-clamp-2 text-xs">{preview}</div>
            <div className="text-muted-foreground mt-2 flex items-center gap-2 text-xs">
              <span className="truncate">
                {account?.username ? `@${account.username}` : accountName}
              </span>
            </div>
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="grid h-full grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Accounts */}
      <Card className="lg:col-span-3">
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-16rem)]">
            <div className="space-y-1 p-2">
              <div className="space-y-1">
                {socialAccounts.map((account) => {
                  const id = String(account.id);
                  const label = account.username
                    ? `@${account.username}`
                    : account.displayName || 'Account';
                  const count = itemCountBySocialAccountId.get(id) || 0;
                  const disabled = Boolean(account.disconnected);
                  const isSelected = selectedAccountId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        if (disabled) return;
                        setSelectedAccountId(id);
                      }}
                      className={cn(
                        'flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors',
                        isSelected ? 'bg-muted border-border' : 'bg-card hover:bg-muted/50',
                        disabled && 'cursor-not-allowed opacity-50'
                      )}
                      aria-disabled={disabled}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <SocialAccountAvatar
                          platform={account.platform as Platform}
                          name={label}
                          src={account.profilePictureUrl || null}
                          size="sm"
                          selected={isSelected}
                          muted={!isSelected}
                          disabled={disabled}
                        />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{label}</div>
                          <div className="text-muted-foreground truncate text-xs">
                            {String(account.platform || '').toUpperCase()}
                          </div>
                        </div>
                      </div>
                      {count > 0 && <span className="text-muted-foreground text-xs">{count}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Items */}
      <Card className="lg:col-span-4">
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Select value={channel} onValueChange={(v) => setChannel(v as InboxChannelFilter)}>
                <SelectTrigger className="h-9 w-[140px]">
                  <SelectValue placeholder="Item type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="comments">Comments</SelectItem>
                  <SelectItem value="dms">Direct messages</SelectItem>
                </SelectContent>
              </Select>
              <Select value={platform} onValueChange={(v) => setPlatform(v as InboxPlatformFilter)}>
                <SelectTrigger className="h-9 w-[140px]">
                  <SelectValue placeholder="Platform" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All platforms</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  syncInboxMutation.mutate({ socialAccountId: selectedAccountId, silent: false })
                }
                disabled={!selectedAccountId || syncInboxMutation.isPending}
              >
                <RotateCw className="mr-1 h-4 w-4" />
                {syncInboxMutation.isPending ? 'Syncing…' : 'Sync'}
              </Button>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Search className="text-muted-foreground h-4 w-4" />
            <Input
              value={itemQuery}
              onChange={(e) => setItemQuery(e.target.value)}
              placeholder="Search inbox..."
              className="h-9"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-16rem)]">
            <div className="space-y-2 p-3">
              {inboxLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="rounded-md border p-3">
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-8 w-8 rounded-full" />
                        <div className="min-w-0 flex-1">
                          <Skeleton className="mb-2 h-4 w-2/3" />
                          <Skeleton className="h-3 w-5/6" />
                        </div>
                        <Skeleton className="h-5 w-10 rounded-full" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : inboxIsError ? (
                <div className="space-y-3 p-3">
                  <div className="text-destructive text-sm">
                    Failed to load inbox items
                    {inboxError instanceof Error ? `: ${inboxError.message}` : '.'}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => refetchInbox()}>
                    Retry
                  </Button>
                </div>
              ) : filteredItems.length ? (
                filteredItems.map(renderItemRow)
              ) : (
                <div className="text-muted-foreground p-6 text-sm">No items found.</div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Detail */}
      <Card className="flex flex-col lg:col-span-5">
        {!selectedItem ? (
          <CardContent className="flex flex-1 items-center justify-center">
            <div className="text-muted-foreground text-center">
              <InboxIcon className="mx-auto mb-3 h-12 w-12" />
              <p className="text-sm font-medium">Select an item</p>
              <p className="text-xs">Choose an item from the list to view details</p>
            </div>
          </CardContent>
        ) : selectedItem.type === 'dm_conversation' ? (
          <>
            <CardHeader className="border-b">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="truncate">{selectedItem.participantUsername}</CardTitle>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {selectedItem.lastMessageDirection === 'inbound'
                      ? 'Inbound message'
                      : 'Conversation'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {selectedItem.state === 'active' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        archiveConversationMutation.mutate(selectedItem.conversationId)
                      }
                      disabled={archiveConversationMutation.isPending}
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
                onSendMessage={async (messageText) => {
                  await sendMessageMutation.mutateAsync(messageText);
                }}
                brandId={brandId}
                disabled={selectedItem.state !== 'active'}
                placeholder={(() => {
                  if (selectedItem.state === 'archived')
                    return 'Cannot reply to archived conversation';
                  if (selectedItem.state === 'spam') return 'Cannot reply to spam conversation';
                  return 'Type your message...';
                })()}
              />
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader className="border-b">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <CardTitle className="truncate">Comments</CardTitle>
                  <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-sm">
                    {selectedItem.previewAuthorUsername ? (
                      <span className="truncate">@{selectedItem.previewAuthorUsername}</span>
                    ) : (
                      <span className="truncate">Thread</span>
                    )}
                    {selectedItem.permalink && (
                      <a
                        href={selectedItem.permalink}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground hover:text-foreground underline"
                      >
                        View on Instagram
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={refreshSelectedThread}
                    disabled={!selectedPublicationId || refreshCommentsMutation.isPending}
                  >
                    <RotateCw className="mr-1 h-4 w-4" /> Refresh
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={markAllRead}
                    disabled={!commentsData?.data?.length}
                  >
                    <CheckCheck className="mr-1 h-4 w-4" /> Mark all read
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4 overflow-hidden p-4">
              <div className="flex items-center gap-3">
                {selectedPreviewUrl ? (
                  <img src={selectedPreviewUrl} alt="" className="h-14 w-14 rounded object-cover" />
                ) : (
                  <div className="bg-muted h-14 w-14 rounded" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-foreground line-clamp-2 text-sm">
                    {selectedItem.caption || '—'}
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden">
                <ScrollArea className="h-full pr-2">
                  {commentsFetching ? (
                    <div className="space-y-3">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="rounded-md border p-2">
                          <Skeleton className="mb-2 h-3 w-1/3" />
                          <Skeleton className="h-4 w-5/6" />
                        </div>
                      ))}
                    </div>
                  ) : commentsData?.data?.length ? (
                    <div className="space-y-4">
                      {commentsData.data.map((c) => (
                        <CommentCard
                          key={c.id}
                          data={c as any}
                          isReplying={activeReplyFor === c.id}
                          isSending={replyMutation.isPending}
                          replyText={replyText}
                          setReplyText={setReplyText}
                          onStartReply={() => setActiveReplyFor(c.id || null)}
                          onCancelReply={() => setActiveReplyFor(null)}
                          onSendReply={() => {
                            if (replyMutation.isPending) return;
                            const msg = replyText.trim();
                            if (!msg) return;
                            if (c.id) replyMutation.mutate({ commentId: c.id, message: msg });
                          }}
                          onLike={() => c.id && likeMutation.mutate({ commentId: c.id })}
                          onResolve={() =>
                            c.id && workflowMutation.mutate({ commentId: c.id, status: 'resolved' })
                          }
                          onArchive={() =>
                            c.id && workflowMutation.mutate({ commentId: c.id, status: 'archived' })
                          }
                          savedReplies={repliesData?.savedReplies || []}
                          onSaveReply={(title, body) => saveReply(title, body)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="text-muted-foreground text-sm">No comments found.</div>
                  )}
                </ScrollArea>
              </div>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
