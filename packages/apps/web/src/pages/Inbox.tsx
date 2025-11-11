import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useBrandStore } from '@/stores/brandStore';
import { useAuthStore } from '@/stores/authStore';
import { content as contentApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { QuickLensChips } from '@/components/QuickLensChips';
import { toast } from 'sonner';
import {
  MessageSquare,
  Heart,
  EyeOff,
  Trash2,
  Send,
  CheckCircle2,
  Clock3,
  UserPlus,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { brand as brandApi } from '@/lib/api';

type HistoryItem = {
  id: string;
  caption: string | null;
  imageUrl: string | null;
  status: 'draft' | 'scheduled' | 'published' | 'failed' | 'skipped';
  postedAt?: string | null;
  scheduledAt?: string | null;
  permalink?: string | null;
};

type CommentItem = { id?: string; text?: string; username?: string; timestamp?: string };

export default function Inbox() {
  const brand = useBrandStore((s) => s.selectedBrand);
  const currentUserId = useAuthStore((s) => s.user?.id || null);
  const brandId = brand?.id;
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [activeReplyFor, setActiveReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  // Reserved: Query client for optimistic updates
  const [activeTab, setActiveTab] = useState<'comments' | 'dms'>('comments');

  // Fetch recent content history to choose a post
  const { data: history } = useQuery<{ content: HistoryItem[] }>({
    queryKey: ['content-history', brandId],
    queryFn: async () => (await contentApi.getContentHistory(brandId!)) as any,
    enabled: !!brandId,
  });

  // Default-select most recent published item
  useEffect(() => {
    if (!selectedPostId && history?.content?.length) {
      const firstPub = history.content.find((c) => c.status === 'published') || history.content[0];
      if (firstPub) setSelectedPostId(firstPub.id);
    }
  }, [history?.content, selectedPostId]);

  // Saved replies
  const { data: repliesData } = useQuery<{
    replies: Array<{ id: string; title: string; body: string }>;
  }>({
    queryKey: ['saved-replies', brandId],
    queryFn: async () => (await brandApi.getSavedReplies(brandId!)) as any,
    enabled: !!brandId,
  });

  // Fetch comments for the selected post
  const {
    data: commentsData,
    refetch: refetchComments,
    isFetching,
  } = useQuery<{
    data: CommentItem[];
    page: number;
    pageSize: number;
    total: number;
  }>({
    queryKey: ['post-comments', selectedPostId],
    queryFn: async () => (await contentApi.getPostComments(selectedPostId!, 1, 50)) as any,
    enabled: !!selectedPostId,
  });

  // Mutations
  const replyMutation = useMutation({
    mutationFn: async (vars: { commentId: string; message: string }) =>
      contentApi.replyToComment(selectedPostId!, vars.commentId, vars.message),
    onSuccess: () => {
      toast.success('Replied');
      setReplyText('');
      setActiveReplyFor(null);
      refetchComments();
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to reply'),
  });

  const hideMutation = useMutation({
    mutationFn: async (vars: { commentId: string; hide: boolean }) =>
      contentApi.setCommentHidden(selectedPostId!, vars.commentId, vars.hide),
    onSuccess: () => {
      toast.success('Updated visibility');
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to update visibility'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (vars: { commentId: string }) =>
      contentApi.deleteComment(selectedPostId!, vars.commentId),
    onSuccess: () => {
      toast.success('Deleted');
      refetchComments();
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to delete'),
  });

  const likeMutation = useMutation({
    mutationFn: async (vars: { commentId: string }) =>
      contentApi.likeComment(selectedPostId!, vars.commentId),
    onSuccess: () => toast.success('Liked'),
    onError: (e: any) => toast.info(e?.message || 'Like not available'),
  });

  const workflowMutation = useMutation({
    mutationFn: async (vars: {
      commentId: string;
      status?: 'open' | 'resolved' | 'snoozed';
      snoozedUntil?: string | null;
      assigneeUserId?: string | null;
    }) => contentApi.setCommentWorkflow(selectedPostId!, vars.commentId, vars),
    onSuccess: () => {
      toast.success('Updated');
      refetchComments();
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to update'),
  });

  const selectedPost = useMemo(
    () => history?.content?.find((c) => c.id === selectedPostId),
    [history?.content, selectedPostId]
  );

  const saveReply = async (title: string, body: string) => {
    if (!brandId) return;
    try {
      await brandApi.createSavedReply(brandId, { title, body });
      toast.success('Saved reply added');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save reply');
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      {/* Left: Recent posts */}
      <Card className="md:col-span-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" /> Inbox
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {history?.content?.length ? (
            history.content.slice(0, 20).map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedPostId(item.id)}
                className={`hover:bg-accent flex w-full items-center gap-3 rounded-md border p-2 text-left transition-colors ${
                  item.id === selectedPostId ? 'border-primary' : 'border-border'
                }`}
              >
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt=""
                    className="h-12 w-12 rounded object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="bg-muted h-12 w-12 rounded" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-foreground line-clamp-2 text-sm">{item.caption || '—'}</div>
                  <div className="text-muted-foreground mt-1 text-xs capitalize">{item.status}</div>
                </div>
              </button>
            ))
          ) : (
            <div className="text-muted-foreground text-sm">No posts yet.</div>
          )}
        </CardContent>
      </Card>

      {/* Right: Conversation */}
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Conversation
            {activeTab === 'comments' ? (
              <Badge variant="secondary">Comment Thread</Badge>
            ) : (
              <Badge variant="info">DM</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'comments' | 'dms')} className="w-full">
            <TabsList>
              <TabsTrigger value="comments">Comments</TabsTrigger>
              <TabsTrigger value="dms">DMs</TabsTrigger>
            </TabsList>

            <TabsContent value="comments" className="mt-4">
              {!selectedPostId && <div className="text-muted-foreground">Select a post</div>}
              {selectedPost && (
                <div className="mb-4 flex items-center gap-3">
                  {selectedPost.imageUrl ? (
                    <img
                      src={selectedPost.imageUrl}
                      alt=""
                      className="h-14 w-14 rounded object-cover"
                    />
                  ) : (
                    <div className="bg-muted h-14 w-14 rounded" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-foreground line-clamp-2 text-sm">
                      {selectedPost.caption || '—'}
                    </div>
                    {selectedPost.permalink && (
                      <a
                        className="text-muted-foreground hover:text-foreground text-xs underline"
                        href={selectedPost.permalink}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View on Instagram
                      </a>
                    )}
                  </div>
                </div>
              )}

              {isFetching ? (
                <div className="text-muted-foreground text-sm">Loading comments…</div>
              ) : commentsData?.data?.length ? (
                <div className="space-y-4">
                  {commentsData.data.map((c) => (
                    <div key={c.id} className="rounded-md border p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="text-foreground font-medium">{c.username || 'User'}</div>
                          {Boolean((c as any).workflow?.status) && (
                            <span className="text-muted-foreground text-xs capitalize">
                              {(c as any).workflow?.status}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            title="Like"
                            onClick={() => c.id && likeMutation.mutate({ commentId: c.id })}
                          >
                            <Heart className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            title="Resolve"
                            onClick={() =>
                              c.id &&
                              workflowMutation.mutate({ commentId: c.id, status: 'resolved' })
                            }
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            title="Snooze 24h"
                            onClick={() =>
                              c.id &&
                              workflowMutation.mutate({
                                commentId: c.id,
                                status: 'snoozed',
                                snoozedUntil: new Date(
                                  Date.now() + 24 * 60 * 60 * 1000
                                ).toISOString(),
                              })
                            }
                          >
                            <Clock3 className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            title="Assign to me"
                            onClick={() =>
                              c.id &&
                              workflowMutation.mutate({
                                commentId: c.id,
                                assigneeUserId: currentUserId,
                              })
                            }
                          >
                            <UserPlus className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            title="Hide"
                            onClick={() =>
                              c.id && hideMutation.mutate({ commentId: c.id, hide: true })
                            }
                          >
                            <EyeOff className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            title="Delete"
                            onClick={() => c.id && deleteMutation.mutate({ commentId: c.id })}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="text-sm">{c.text}</div>
                      <div className="mt-2">
                        <QuickLensChips text={c.text || ''} />
                      </div>
                      {/* Reply box */}
                      <div className="mt-3 flex flex-col gap-2">
                        {/* Saved reply chips */}
                        {repliesData?.replies?.length ? (
                          <div className="flex flex-wrap gap-2">
                            {repliesData.replies.slice(0, 5).map((r) => (
                              <Button
                                key={r.id}
                                size="sm"
                                variant="secondary"
                                onClick={() =>
                                  setReplyText((prev) => (prev ? prev + ' ' + r.body : r.body))
                                }
                              >
                                {r.title}
                              </Button>
                            ))}
                          </div>
                        ) : null}
                        <div className="flex items-end gap-2">
                          {activeReplyFor === c.id ? (
                            <>
                              <Textarea
                                value={replyText}
                                onChange={(e) => setReplyText(e.target.value)}
                                placeholder={`Replying to @${c.username || ''}`}
                                className="flex-1"
                              />
                              <Button
                                onClick={() =>
                                  c.id &&
                                  replyMutation.mutate({ commentId: c.id, message: replyText })
                                }
                                disabled={!replyText.trim() || replyMutation.isPending}
                              >
                                <Send className="mr-1 h-4 w-4" /> Send
                              </Button>
                              <Button
                                variant="secondary"
                                disabled={!replyText.trim()}
                                onClick={() =>
                                  saveReply(
                                    replyText.slice(0, 30) + (replyText.length > 30 ? '…' : ''),
                                    replyText
                                  )
                                }
                              >
                                Save as reply
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setActiveReplyFor(c.id || null)}
                            >
                              Reply
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-muted-foreground text-sm">No comments found.</div>
              )}
            </TabsContent>

            <TabsContent value="dms" className="mt-4">
              <DMsPanel />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function DMsPanel() {
  const brand = useBrandStore((s) => s.selectedBrand);
  const brandId = brand?.id;
  const [threads, setThreads] = useState<
    Array<{ id: string; updated_time?: string; participants?: any[] }>
  >([]);
  const [threadsAfter, setThreadsAfter] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<
    Array<{ id: string; message?: string; from?: any; created_time?: string }>
  >([]);
  const [messagesBefore, setMessagesBefore] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [composer, setComposer] = useState('');
  const [windowClosed, setWindowClosed] = useState(false);
  const [supported, setSupported] = useState(true);

  const loadThreads = async (after?: string | null) => {
    if (!brandId) return;
    const res = (await brandApi.getDmThreads(brandId, {
      limit: 25,
      after: after || undefined,
    })) as any;
    if (res?.supported === false) {
      setSupported(false);
      return;
    }
    setSupported(true);
    const list = Array.isArray(res?.threads) ? res.threads : [];
    setThreads((prev) => (after ? [...prev, ...list] : list));
    const nextAfter = res?.paging?.cursors?.after || null;
    setThreadsAfter(nextAfter);
    if (!after && list.length && !selectedThreadId) setSelectedThreadId(list[0].id);
  };

  const loadMessages = async (threadId: string, before?: string | null) => {
    if (!brandId) return;
    setLoadingMessages(true);
    try {
      const res = (await brandApi.getDmMessages(brandId, threadId, {
        limit: 25,
        before: before || undefined,
      })) as any;
      if (res?.supported === false) {
        setSupported(false);
        setMessages([]);
        return;
      }
      setSupported(true);
      const rows = Array.isArray(res?.messages) ? res.messages : [];
      // Sort ascending by created_time
      rows.sort(
        (a: any, b: any) =>
          new Date(a.created_time || 0).getTime() - new Date(b.created_time || 0).getTime()
      );
      setMessages((prev) => (before ? [...rows, ...prev] : rows));
      const nextBefore = res?.paging?.cursors?.before || null;
      setMessagesBefore(nextBefore);
      // Reset window closed flag; will be re-evaluated on send
      setWindowClosed(false);
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    // Initial load threads on brand change
    if (brandId) {
      setThreads([]);
      setThreadsAfter(null);
      setSelectedThreadId(null);
      loadThreads(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId]);

  useEffect(() => {
    if (selectedThreadId) {
      setMessages([]);
      setMessagesBefore(null);
      loadMessages(selectedThreadId, null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedThreadId]);

  const onSend = async () => {
    if (!brandId || !selectedThreadId || !composer.trim()) return;
    try {
      const res = (await brandApi.sendDmMessage(brandId, selectedThreadId, composer.trim())) as any;
      if (res?.supported === false) {
        toast.info('Instagram messaging not supported for this account/app');
        return;
      }
      if (res?.error === 'WINDOW_CLOSED') {
        setWindowClosed(true);
        toast.info('24-hour window closed. Unable to send.');
        return;
      }
      setComposer('');
      // Refresh messages after send
      await loadMessages(selectedThreadId, null);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to send');
    }
  };

  if (!brandId)
    return <div className="text-muted-foreground text-sm">Select a brand to view DMs.</div>;
  if (!supported)
    return (
      <div className="text-muted-foreground text-sm">
        Instagram messaging not enabled for this brand/app.
      </div>
    );

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {/* Threads list */}
      <div className="md:col-span-1">
        <div className="mb-2 text-sm font-medium">Conversations</div>
        <div className="space-y-2">
          {threads.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedThreadId(t.id)}
              className={`hover:bg-accent w-full rounded-md border p-2 text-left ${
                t.id === selectedThreadId ? 'border-primary' : 'border-border'
              }`}
            >
              <div className="line-clamp-1 text-sm">
                {(t.participants || [])
                  .map((p: any) => p?.name || p?.username || p?.id)
                  .filter(Boolean)
                  .slice(0, 3)
                  .join(', ') || 'Conversation'}
              </div>
              <div className="text-muted-foreground mt-1 text-xs">
                {t.updated_time ? new Date(t.updated_time).toLocaleString() : ''}
              </div>
            </button>
          ))}
          {threadsAfter && (
            <Button variant="outline" onClick={() => loadThreads(threadsAfter)}>
              Load more threads
            </Button>
          )}
          {!threads.length && (
            <div className="text-muted-foreground text-sm">No threads found.</div>
          )}
        </div>
      </div>

      {/* Messages panel */}
      <div className="md:col-span-2">
        {selectedThreadId ? (
          <div className="flex h-full flex-col">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-medium">Thread {selectedThreadId}</div>
              {messagesBefore && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => loadMessages(selectedThreadId, messagesBefore)}
                >
                  Load older
                </Button>
              )}
            </div>
            <div className="bg-muted/20 flex-1 space-y-3 overflow-auto rounded-md border p-3">
              {loadingMessages ? (
                <div className="text-muted-foreground text-sm">Loading messages…</div>
              ) : messages.length ? (
                messages.map((m) => (
                  <div key={m.id} className="bg-card rounded-md border p-2">
                    <div className="text-muted-foreground mb-1 text-xs">
                      {m.from?.name || m.from?.username || m.from?.id || 'User'} •{' '}
                      {m.created_time ? new Date(m.created_time).toLocaleString() : ''}
                    </div>
                    <div className="whitespace-pre-wrap text-sm">{m.message}</div>
                  </div>
                ))
              ) : (
                <div className="text-muted-foreground text-sm">No messages yet.</div>
              )}
            </div>
            <div className="mt-3 flex items-end gap-2">
              <Textarea
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                placeholder={
                  windowClosed ? 'Window closed. Reply on Instagram to re-open.' : 'Type a message…'
                }
                className="flex-1"
                disabled={windowClosed}
              />
              <Button onClick={onSend} disabled={!composer.trim() || windowClosed}>
                <Send className="mr-1 h-4 w-4" /> Send
              </Button>
            </div>
            {windowClosed && (
              <div className="text-muted-foreground mt-1 text-xs">
                24-hour messaging window has expired for this thread.
              </div>
            )}
          </div>
        ) : (
          <div className="text-muted-foreground text-sm">Select a thread to view messages.</div>
        )}
      </div>
    </div>
  );
}
