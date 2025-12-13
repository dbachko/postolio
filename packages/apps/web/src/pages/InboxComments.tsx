import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useBrandStore } from '@/stores/brandStore';
import { content as contentApi, brand as brandApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { CommentsSidebar } from '@/components/inbox/CommentsSidebar';
import { CommentCard } from '@/components/inbox/CommentCard';
import { toast } from 'sonner';
import { CheckCheck } from 'lucide-react';
import { useAssetsByIds } from '@/features/assets/hooks/useAssetsByIds';

type InboxItem = {
  postId: string;
  caption: string | null;
  primaryAssetId: string | null;
  permalink: string | null;
  postedAt: string | null;
  totalComments: number;
  resolvedCount: number;
  newCount: number;
};

type CommentItem = { id?: string; text?: string; username?: string; timestamp?: string };

export default function InboxComments() {
  const brand = useBrandStore((s) => s.selectedBrand);
  // Assignment removed
  const brandId = brand?.id;
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [activeReplyFor, setActiveReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  // Fetch posts with new comment activity
  const {
    data: inboxData,
    refetch: refetchInbox,
    isLoading: inboxLoading,
  } = useQuery<{ items: InboxItem[] }>({
    queryKey: ['inbox-comments', brandId],
    queryFn: async () => (await brandApi.getCommentsInbox(brandId!)) as any,
    enabled: !!brandId,
  });

  const items = useMemo(() => (inboxData?.items || []) as InboxItem[], [inboxData]);
  const primaryAssetIds = useMemo(() => items.map((item) => item.primaryAssetId), [items]);
  const { data: assetsById } = useAssetsByIds(primaryAssetIds);

  // Default select first item with new activity
  useEffect(() => {
    if (!selectedPostId && items.length) {
      setSelectedPostId(items[0].postId);
    }
  }, [items, selectedPostId]);

  // Saved replies
  const { data: repliesData } = useQuery<{
    replies: Array<{ id: string; title: string; body: string }>;
  }>({
    queryKey: ['saved-replies', brandId],
    queryFn: async () => (await brandApi.getSavedReplies(brandId!)) as any,
    enabled: !!brandId,
  });

  // Fetch comments for selected post
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

  // hide/delete removed

  const likeMutation = useMutation({
    mutationFn: async (vars: { commentId: string }) =>
      contentApi.likeComment(selectedPostId!, vars.commentId),
    onSuccess: () => toast.success('Liked'),
    onError: (e: any) => toast.info(e?.message || 'Like not available'),
  });

  const workflowMutation = useMutation({
    mutationFn: async (vars: { commentId: string; status?: 'open' | 'resolved' | 'archived' }) =>
      contentApi.setCommentWorkflow(selectedPostId!, vars.commentId, vars),
    onSuccess: async () => {
      await Promise.all([refetchComments(), refetchInbox()]);
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to update'),
  });

  const selectedItem = useMemo(
    () => items.find((i) => i.postId === selectedPostId),
    [items, selectedPostId]
  );

  const selectedPreviewUrl = useMemo(() => {
    if (!selectedItem?.primaryAssetId) return null;
    const asset = assetsById?.[selectedItem.primaryAssetId] ?? null;
    return asset?.thumbnailUrl || asset?.url || null;
  }, [assetsById, selectedItem?.primaryAssetId]);

  const saveReply = async (title: string, body: string) => {
    if (!brandId) return;
    try {
      await brandApi.createSavedReply(brandId, { title, body });
      toast.success('Saved reply added');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save reply');
    }
  };

  const markAllRead = async () => {
    const cs = commentsData?.data || [];
    if (!selectedPostId || !cs.length) return;
    try {
      const ids = cs.map((c) => String(c.id || '')).filter(Boolean);
      await contentApi.markAllCommentsRead(selectedPostId, ids);
      toast.success('Marked all as read');
      await Promise.all([refetchComments(), refetchInbox()]);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to mark all as read');
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">Comments</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={markAllRead}
            disabled={!commentsData?.data?.length}
          >
            <CheckCheck className="mr-1 h-4 w-4" /> Mark all read
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="md:col-span-1">
            {brandId && inboxLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-md border p-2">
                    <Skeleton className="h-12 w-12 rounded" />
                    <div className="min-w-0 flex-1">
                      <Skeleton className="mb-1 h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                    <Skeleton className="h-5 w-10 rounded-full" />
                  </div>
                ))}
              </div>
            ) : (
              <CommentsSidebar
                items={items.map((i) => ({
                  postId: i.postId,
                  caption: i.caption,
                  previewUrl: i.primaryAssetId
                    ? assetsById?.[i.primaryAssetId]?.thumbnailUrl ||
                      assetsById?.[i.primaryAssetId]?.url ||
                      null
                    : null,
                  postedAt: i.postedAt,
                  newCount: i.newCount,
                }))}
                selectedPostId={selectedPostId}
                onSelect={(id) => setSelectedPostId(id)}
              />
            )}
          </div>
          <div className="md:col-span-2">
            {brandId && inboxLoading ? (
              <div className="mb-4 flex items-center gap-3">
                <Skeleton className="h-14 w-14 rounded" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="mb-2 h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ) : (
              !selectedPostId && <div className="text-muted-foreground">Select a post</div>
            )}
            {selectedItem && (
              <div className="mb-4 flex items-center gap-3">
                {selectedPreviewUrl ? (
                  <img src={selectedPreviewUrl} alt="" className="h-14 w-14 rounded object-cover" />
                ) : (
                  <div className="bg-muted h-14 w-14 rounded" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-foreground line-clamp-2 text-sm">
                    {selectedItem.caption || '—'}
                  </div>
                  {selectedItem.permalink && (
                    <a
                      className="text-muted-foreground hover:text-foreground text-xs underline"
                      href={selectedItem.permalink}
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
                    savedReplies={repliesData?.replies || []}
                    onSaveReply={(title, body) => saveReply(title, body)}
                  />
                ))}
              </div>
            ) : selectedPostId ? (
              <div className="text-muted-foreground text-sm">No comments found.</div>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
