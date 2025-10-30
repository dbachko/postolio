import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { content as contentApi, campaign as campaignApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ImageUploader } from '@/components/ImageUploader';
import { PostCaptionEditor } from '@/components/PostCaptionEditor';
import { PostHashtagEditor } from '@/components/PostHashtagEditor';
import { PostScheduler } from '@/components/PostScheduler';
import { useDebounce } from '@/hooks/useDebounce';
import { useTimezone } from '@/contexts/TimezoneContext';
import { convertLocalToUTC } from '@/lib/timezone';
import { Link, useNavigate } from 'react-router-dom';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { X, Clock, Save, Upload, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { useBrandStore } from '@/stores/brandStore';
import { validateImageFile } from '@/lib/fileUtils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
  const { close } = useRightSidebarRouter();
  const navigate = useNavigate();
  const { timezone, getBrandTimezone } = useTimezone();
  const { selectedBrand } = useBrandStore();
  const [brandTimezone, setBrandTimezone] = useState<string>(timezone);
  const queryClient = useQueryClient();
  const objectUrlRef = useRef<string | null>(null);

  // Determine if we're in creation mode
  const isCreating = !id;

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

  // Save as draft mutation
  const { mutate: saveAsDraft, isPending: isSavingDraft } = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('No post ID');
      const normalizeHashtags = (tags: string[] | undefined | null) =>
        (tags || [])
          .map((t) => (typeof t === 'string' ? t.replace(/^#+/, '') : ''))
          .filter((t) => t.length > 0);

      return contentApi.updateContent({
        contentId: id,
        caption: formData.caption.trim(),
        hashtags: normalizeHashtags(formData.hashtags),
        imageUrl: formData.imageUrl || undefined,
        scheduledAt: undefined, // Clear schedule to make it a draft
      });
    },
    onSuccess: (response) => {
      toast.success('Saved as draft');
      queryClient.setQueryData(['post', id], (oldData: PostDetailData | undefined) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          ...response.content,
          status: 'draft',
        } as PostDetailData;
      });
    },
    onError: () => toast.error('Failed to save as draft'),
  });

  // Schedule post mutation
  const { mutate: schedulePost, isPending: isScheduling } = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('No post ID');
      if (!formData.scheduledAt) throw new Error('No scheduled time set');

      const normalizeHashtags = (tags: string[] | undefined | null) =>
        (tags || [])
          .map((t) => (typeof t === 'string' ? t.replace(/^#+/, '') : ''))
          .filter((t) => t.length > 0);

      const scheduledUtc = convertLocalToUTC(
        new Date(formData.scheduledAt),
        brandTimezone
      ).toISOString();

      return contentApi.updateContent({
        contentId: id,
        caption: formData.caption.trim(),
        hashtags: normalizeHashtags(formData.hashtags),
        imageUrl: formData.imageUrl || undefined,
        scheduledAt: scheduledUtc,
      });
    },
    onSuccess: (response) => {
      toast.success('Post scheduled successfully');
      queryClient.setQueryData(['post', id], (oldData: PostDetailData | undefined) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          ...response.content,
          status: 'scheduled',
        } as PostDetailData;
      });
    },
    onError: () => toast.error('Failed to schedule post'),
  });

  // Create post mutation (for creation mode)
  const { mutate: createPost, isPending: isCreatingPost } = useMutation({
    mutationFn: async (mode: 'draft' | 'schedule') => {
      if (!selectedBrand) throw new Error('No brand selected');

      const normalizeHashtags = (tags: string[] | undefined | null) =>
        (tags || [])
          .map((t) => (typeof t === 'string' ? t.replace(/^#+/, '') : ''))
          .filter((t) => t.length > 0);

      const hashtagArray = Array.from(new Set(normalizeHashtags(formData.hashtags)));

      return contentApi.createManualContent({
        brandId: selectedBrand.id,
        caption: formData.caption.trim(),
        hashtags: hashtagArray,
        imageFile: imageFile || undefined,
        campaignId: selectedCampaign || undefined,
        scheduledAt: mode === 'schedule' ? formData.scheduledAt : undefined,
      });
    },
    onSuccess: (_response, mode) => {
      queryClient.invalidateQueries({ queryKey: ['content'] });
      queryClient.invalidateQueries({ queryKey: ['calendar'] });

      const isScheduled = mode === 'schedule';
      const hasCampaign = !!selectedCampaign;

      let message = 'Post created successfully!';
      if (isScheduled && hasCampaign) {
        message = 'Post scheduled and added to campaign!';
      } else if (isScheduled) {
        message = 'Post created and scheduled!';
      } else if (hasCampaign) {
        message = 'Post created and added to campaign!';
      }

      toast.success(message, {
        description: isScheduled
          ? 'You can view it in the content calendar'
          : 'You can find it in the content calendar as a draft',
      });

      // Navigate to content calendar where they can see the post
      navigate('/content');
      close();
    },
    onError: (error: Error) => {
      console.error('Failed to create post:', error);
      toast.error(error.message || 'Failed to create post. Please try again.');
    },
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

  // Campaign selection state
  const [selectedCampaign, setSelectedCampaign] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  // Fetch campaigns for the brand
  useEffect(() => {
    let mounted = true;
    const fetchCampaigns = async () => {
      const brandId = isCreating ? selectedBrand?.id : post?.brand?.id;
      if (!brandId) return;
      setIsLoadingCampaigns(true);
      try {
        const res = await campaignApi.listCampaigns(brandId);
        if (mounted) setCampaigns(res.campaigns || []);
      } catch (_error) {
        if (mounted) toast.error('Failed to load campaigns');
      } finally {
        if (mounted) setIsLoadingCampaigns(false);
      }
    };
    fetchCampaigns();
    return () => {
      mounted = false;
    };
  }, [isCreating, selectedBrand?.id, post?.brand?.id]);

  // Navigate to campaign create/edit page
  const handleCampaignEdit = (campaignId?: string) => {
    if (campaignId) {
      navigate(`/campaigns/${campaignId}`);
    } else {
      navigate('/campaigns/create');
    }
  };

  return (
    <div
      className="flex h-full flex-col shadow-lg"
      role="complementary"
      aria-labelledby="right-sidebar-title"
    >
      <div className="bg-card sticky top-0 z-10 flex h-14 items-center justify-between border-b px-4">
        {id ? (
          <Breadcrumb aria-label="right-sidebar-title">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to={`/posts/${id}?edit=1`}>{isLoading ? 'Loading…' : 'Edit Post'}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        ) : (
          <Breadcrumb aria-label="right-sidebar-title">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>Create New Post</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        )}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={close} aria-label="Close sidebar">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <Separator />
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isCreating ? (
          // Creation mode
          <div className="space-y-4">
            {!selectedBrand ? (
              <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                Please select a brand first
              </div>
            ) : (
              <>
                {/* Image Upload */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Upload className="h-4 w-4" />
                    Post Image
                  </Label>
                  <ImageUploader
                    value={imagePreview || undefined}
                    onChange={(fileOrUrl) => {
                      if (fileOrUrl instanceof File) {
                        const error = validateImageFile(fileOrUrl, 10);
                        if (error) {
                          toast.error(error);
                          return;
                        }
                        setImageFile(fileOrUrl);
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          setImagePreview(reader.result as string);
                        };
                        reader.readAsDataURL(fileOrUrl);
                      } else if (typeof fileOrUrl === 'string') {
                        // Handle URL case (though unlikely in creation mode)
                        setImagePreview(fileOrUrl);
                        setImageFile(null);
                      } else {
                        // Clear case
                        setImagePreview(null);
                        setImageFile(null);
                      }
                    }}
                    maxSizeInMB={10}
                    acceptedFormats={['image/jpeg', 'image/jpg', 'image/png', 'image/webp']}
                  />
                  <p className="text-muted-foreground text-sm">
                    Upload an image for your post (optional, max 10MB)
                  </p>
                </div>

                <PostCaptionEditor
                  value={formData.caption}
                  onChange={(v) => setFormData((s) => ({ ...s, caption: v }))}
                  disabled={false}
                  showIcon={true}
                />

                <PostHashtagEditor
                  hashtags={formData.hashtags}
                  onChange={(tags) => setFormData((s) => ({ ...s, hashtags: tags }))}
                  disabled={false}
                  showIcon={true}
                />

                <PostScheduler
                  value={formData.scheduledAt}
                  onChange={(v) => setFormData((s) => ({ ...s, scheduledAt: v }))}
                  disabled={false}
                  showIcon={true}
                />

                {/* Campaign Selection */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Campaign (Optional)
                  </Label>
                  <Select
                    value={selectedCampaign || undefined}
                    onValueChange={setSelectedCampaign}
                    disabled={false}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a campaign (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      {isLoadingCampaigns ? (
                        <SelectItem value="__loading" disabled>
                          Loading campaigns...
                        </SelectItem>
                      ) : campaigns.length === 0 ? (
                        <SelectItem value="__empty" disabled>
                          No campaigns found
                        </SelectItem>
                      ) : (
                        campaigns.map((campaign) => (
                          <SelectItem key={campaign.id} value={campaign.id}>
                            {campaign.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-sm">
                    Optional: assign this post to a campaign
                  </p>
                  <Button variant="outline" onClick={() => handleCampaignEdit()} className="w-full">
                    Create/Edit Campaign
                  </Button>
                </div>

                {/* Action Buttons */}
                <div className="space-y-3 pt-4">
                  <Separator />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => createPost('draft')}
                      disabled={isCreatingPost || !formData.caption?.trim()}
                    >
                      {isCreatingPost ? (
                        <>
                          <Save className="mr-2 h-4 w-4 animate-pulse" />
                          Creating...
                        </>
                      ) : (
                        <>
                          <Save className="mr-2 h-4 w-4" />
                          Save as Draft
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={() => createPost('schedule')}
                      disabled={
                        isCreatingPost || !formData.caption?.trim() || !formData.scheduledAt
                      }
                    >
                      {isCreatingPost ? (
                        <>
                          <Clock className="mr-2 h-4 w-4 animate-pulse" />
                          Creating...
                        </>
                      ) : (
                        <>
                          <Clock className="mr-2 h-4 w-4" />
                          Schedule Post
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : // Editing mode
        isLoading || !post ? (
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
              showIcon={true}
            />

            <PostHashtagEditor
              hashtags={formData.hashtags}
              onChange={(tags) => setFormData((s) => ({ ...s, hashtags: tags }))}
              disabled={disabled}
              showIcon={true}
            />

            <PostScheduler
              value={formData.scheduledAt}
              onChange={(v) => setFormData((s) => ({ ...s, scheduledAt: v }))}
              disabled={disabled}
              showIcon={true}
            />

            {/* Campaign Selection */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Campaign (Optional)
              </Label>
              <Select
                value={selectedCampaign || undefined}
                onValueChange={setSelectedCampaign}
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a campaign" />
                </SelectTrigger>
                <SelectContent>
                  {isLoadingCampaigns ? (
                    <SelectItem value="__loading" disabled>
                      Loading campaigns...
                    </SelectItem>
                  ) : campaigns.length === 0 ? (
                    <SelectItem value="__empty" disabled>
                      No campaigns found
                    </SelectItem>
                  ) : (
                    campaigns.map((campaign) => (
                      <SelectItem key={campaign.id} value={campaign.id}>
                        {campaign.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-sm">
                Optional: assign this post to a campaign
              </p>
              <Button
                variant="outline"
                onClick={() => handleCampaignEdit()}
                disabled={disabled}
                className="w-full"
              >
                Create/Edit Campaign
              </Button>
            </div>

            {/* Action Buttons */}
            {!disabled && (
              <div className="space-y-3 pt-4">
                <Separator />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => saveAsDraft()}
                    disabled={isSavingDraft || !formData.caption?.trim()}
                  >
                    {isSavingDraft ? (
                      <>
                        <Save className="mr-2 h-4 w-4 animate-pulse" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save as Draft
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={() => schedulePost()}
                    disabled={isScheduling || !formData.caption?.trim() || !formData.scheduledAt}
                  >
                    {isScheduling ? (
                      <>
                        <Clock className="mr-2 h-4 w-4 animate-pulse" />
                        Scheduling...
                      </>
                    ) : (
                      <>
                        <Clock className="mr-2 h-4 w-4" />
                        Schedule Post
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
