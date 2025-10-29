import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { content as contentApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ImageUploader } from '@/components/ImageUploader';
import { PostCaptionEditor } from '@/components/PostCaptionEditor';
import { PostHashtagEditor } from '@/components/PostHashtagEditor';
import { PostScheduler } from '@/components/PostScheduler';
import { useDebounce } from '@/hooks/useDebounce';
import { useTimezone } from '@/contexts/TimezoneContext';
import { convertLocalToUTC } from '@/lib/timezone';
import { useNavigate } from 'react-router-dom';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { X, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

interface PostDetailData {
  id: string;
  caption: string;
  hashtags: string[];
  imageUrl?: string;
  status: string; // 'draft' | 'scheduled' | 'published' | ...
  scheduledAt?: string;
  brand: { id: string; name: string };
}

export function PostSidebar({ id }: { id?: string }) {
  const navigate = useNavigate();
  const { close } = useRightSidebarRouter();
  const { timezone, getBrandTimezone } = useTimezone();
  const [brandTimezone, setBrandTimezone] = useState<string>(timezone);
  const queryClient = useQueryClient();
  const objectUrlRef = useRef<string | null>(null);

  const { data: post, isLoading } = useQuery<PostDetailData>({
    queryKey: ['post', id],
    queryFn: async () => (await contentApi.getPostDetail(id!)).data,
    enabled: Boolean(id),
    staleTime: 10000,
  });

  useEffect(() => {
    let mounted = true;
    (async () => {
      const brandId = post?.brand?.id;
      if (!brandId) return;
      try {
        const tz = await getBrandTimezone(brandId);
        if (mounted && tz) setBrandTimezone(tz);
      } catch {
        if (mounted) setBrandTimezone(timezone);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [post?.brand?.id, getBrandTimezone, timezone]);

  const [formData, setFormData] = useState({
    caption: '',
    hashtags: [] as string[],
    imageUrl: '',
    scheduledAt: '',
  });

  // Initialize form from post
  useEffect(() => {
    if (!post) return;
    setFormData({
      caption: post.caption || '',
      hashtags: (post.hashtags || []).map((t: string) => (t.startsWith('#') ? t.slice(1) : t)),
      imageUrl: post.imageUrl || '',
      scheduledAt: post.scheduledAt ? new Date(post.scheduledAt).toISOString().slice(0, 16) : '',
    });
  }, [post]);

  // Clean up object URL on unmount
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  const disabled = post?.status === 'published';

  const debouncedFormData = useDebounce(formData, 500);
  const { mutate: mutateContent, isPending: isSaving } = useMutation({
    mutationFn: async (data: {
      contentId: string;
      caption?: string;
      hashtags?: string[];
      imageUrl?: string;
      scheduledAt?: string;
    }) => contentApi.updateContent(data),
    onSuccess: (response) => {
      queryClient.setQueryData(['post', id], (oldData: PostDetailData | undefined) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          ...response.content,
          // keep status in case server omits it
          status: response.content?.status || oldData.status,
        } as PostDetailData;
      });
    },
    onError: () => toast.error('Failed to save changes'),
  });

  // Auto-save
  useEffect(() => {
    if (!post || !id || disabled) return;
    if (!debouncedFormData.caption || debouncedFormData.caption.trim().length === 0) return;
    if (isSaving) return;

    const normalizeHashtags = (tags: string[] | undefined | null) =>
      (tags || [])
        .map((t) => (typeof t === 'string' ? t.replace(/^#+/, '') : ''))
        .filter((t) => t.length > 0);

    const currentScheduledUtc = post.scheduledAt
      ? new Date(post.scheduledAt).toISOString()
      : undefined;
    const formScheduledUtc = debouncedFormData.scheduledAt
      ? convertLocalToUTC(new Date(debouncedFormData.scheduledAt), brandTimezone).toISOString()
      : undefined;
    const scheduledChanged = currentScheduledUtc !== formScheduledUtc;

    const hasChanges =
      debouncedFormData.caption.trim() !== (post.caption || '') ||
      JSON.stringify(normalizeHashtags(debouncedFormData.hashtags)) !==
        JSON.stringify(normalizeHashtags(post.hashtags as unknown as string[])) ||
      debouncedFormData.imageUrl !== (post.imageUrl || '') ||
      scheduledChanged;

    if (!hasChanges) return;

    mutateContent({
      contentId: id,
      caption: debouncedFormData.caption.trim(),
      hashtags: normalizeHashtags(debouncedFormData.hashtags),
      imageUrl: debouncedFormData.imageUrl || undefined,
      ...(scheduledChanged ? { scheduledAt: formScheduledUtc } : {}),
    });
  }, [debouncedFormData, brandTimezone, post, id, disabled, isSaving, mutateContent]);

  const handleImageChange = async (fileOrUrl?: File | string | null) => {
    if (!id || !fileOrUrl || disabled) return;
    if (typeof fileOrUrl === 'string') {
      setFormData((s) => ({ ...s, imageUrl: fileOrUrl }));
      return;
    }
    const res = await contentApi.uploadContentImage(id, fileOrUrl);
    const url = res?.content?.imageUrl;
    if (url) setFormData((s) => ({ ...s, imageUrl: url }));
  };

  return (
    <div
      className="flex h-full flex-col"
      role="complementary"
      aria-labelledby="right-sidebar-title"
    >
      <div className="flex items-center justify-between px-3 py-2">
        <h2 id="right-sidebar-title" className="text-sm font-semibold">
          {isLoading ? 'Loading…' : 'Edit Post'}
        </h2>
        <div className="flex items-center gap-2">
          {id && (
            <Button variant="secondary" size="sm" onClick={() => navigate(`/posts/${id}?edit=1`)}>
              <ExternalLink className="mr-1 h-4 w-4" />
              Open full page
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={close} aria-label="Close sidebar">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <Separator />
      <ScrollArea className="flex-1 p-3">
        {isLoading || !post ? (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            Loading...
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Post Image</Label>
              {disabled ? (
                formData.imageUrl ? (
                  <div className="bg-muted overflow-hidden rounded-lg">
                    <img
                      src={formData.imageUrl}
                      alt="Post content"
                      className="h-auto max-h-[400px] w-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                ) : (
                  <div className="text-muted-foreground text-sm">No image</div>
                )
              ) : (
                <ImageUploader
                  value={formData.imageUrl || undefined}
                  onChange={handleImageChange}
                  maxSizeInMB={10}
                  acceptedFormats={['image/jpeg', 'image/jpg', 'image/png', 'image/webp']}
                />
              )}
            </div>

            <PostCaptionEditor
              value={formData.caption}
              onChange={(v) => setFormData((s) => ({ ...s, caption: v }))}
              disabled={disabled}
            />

            <PostHashtagEditor
              hashtags={formData.hashtags}
              onChange={(tags) => setFormData((s) => ({ ...s, hashtags: tags }))}
              disabled={disabled}
            />

            <PostScheduler
              value={formData.scheduledAt}
              onChange={(v) => setFormData((s) => ({ ...s, scheduledAt: v }))}
              disabled={disabled}
            />
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
