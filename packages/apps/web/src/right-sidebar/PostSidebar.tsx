import { useEffect, useMemo, useRef, useState } from 'react';
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
import { VideoUploader } from '@/components/VideoUploader';
import { MultiImageUploader, type AssetReference } from '@/components/MultiImageUploader';
import { PostCaptionEditor } from '@/components/PostCaptionEditor';
import { PostHashtagEditor } from '@/components/PostHashtagEditor';
import { PostScheduler } from '@/components/PostScheduler';
import { PostStatusCard, type PostStatus } from '@/components/PostStatusCard';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useTimezone } from '@/contexts/TimezoneContext';
import { toUTCFromInput } from '@/lib/timezone';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import {
  X,
  Clock,
  Save,
  Upload,
  Calendar,
  HelpCircle,
  Image as ImageIcon,
  Film,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { useBrandStore } from '@/stores/brandStore';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { normalizeHashtags, stripHashtagPrefixes } from '@/utils/hashtags';
import { cn } from '@/lib/utils';
import { AppEmptyState } from '@/components/AppEmptyState';
import {
  validateContentPayload,
  type InstagramContentType,
  type InstagramMediaType,
} from '@postolio/content-validation';
import AssetPicker from '@/features/assets/components/AssetPicker';
import { Switch } from '@/components/ui/switch';

interface PostDetailData {
  id: string;
  caption: string;
  hashtags: string[];
  imageUrl?: string;
  videoUrl?: string;
  mediaType?: string;
  contentType?: string;
  shareToFeed?: boolean | null;
  status: string; // 'draft' | 'scheduled' | 'published' | ...
  scheduledAt?: string;
  brandId?: string;
  brand: { id: string; name: string };
  mediaAssets?: { cdnUrl: string; usageContext: string; displayOrder: number; assetId?: string }[];
  schedulingError?: string | null;
  createdAt?: string;
  updatedAt?: string;
  generationParams?: {
    processing?: {
      active: boolean;
      operation: 'scheduling';
      startedAt: string;
      operationId?: string;
    };
  };
  campaignId?: string | null;
  campaign?: {
    id: string;
    name: string;
    status?: string;
  } | null;
}

const formatScheduledInput = (value?: string) =>
  value ? new Date(value).toISOString().slice(0, 16) : '';

type PostSidebarLayout = 'sidebar' | 'page';

interface PostSidebarProps {
  id?: string;
  layout?: PostSidebarLayout;
  onClose?: () => void;
  showHeader?: boolean;
}

export function PostSidebar({
  id,
  layout = 'sidebar',
  onClose,
  showHeader = true,
}: PostSidebarProps) {
  const { close } = useRightSidebarRouter();
  const navigate = useNavigate();
  const location = useLocation();
  const { timezone, getBrandTimezone } = useTimezone();
  const { selectedBrand } = useBrandStore();
  const [brandTimezone, setBrandTimezone] = useState<string>(timezone);
  const queryClient = useQueryClient();
  const objectUrlRef = useRef<string | null>(null);

  // Determine if we're in creation mode
  const isCreating = !id;

  const { data: post, isLoading } = useQuery<PostDetailData>({
    queryKey: ['post', id],
    queryFn: async () => {
      const response = await contentApi.getPostDetail(id!);
      return {
        ...response.data,
        brandId: response.data.brand?.id,
      };
    },
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
    videoUrl: '',
    carouselAssets: [] as AssetReference[],
    contentType: 'post' as InstagramContentType,
    mediaType: 'image' as InstagramMediaType,
    scheduledAt: '',
    shareToFeed: true,
  });
  const [hasChanges, setHasChanges] = useState(false);
  const formInitializedRef = useRef(false);
  const hasScheduleTime = Boolean(formData.scheduledAt);
  const [showAssetPicker, setShowAssetPicker] = useState(false);

  const finalMediaType = useMemo<InstagramMediaType>(() => {
    // For reels, always treat media format as video; for other content types
    // rely on the explicit mediaType ('image' | 'video').
    if (formData.contentType === 'reel') return 'video';
    return formData.mediaType === 'video' ? 'video' : 'image';
  }, [formData.contentType, formData.mediaType]);

  const validation = useMemo(() => {
    const isStory = formData.contentType === 'story';
    const mediaKeys: string[] = [];
    if (formData.carouselAssets?.length)
      mediaKeys.push(...formData.carouselAssets.map((a) => a.url));
    if (formData.imageUrl) mediaKeys.push(formData.imageUrl);

    return validateContentPayload({
      platform: 'instagram',
      contentType: formData.contentType,
      mediaType: finalMediaType,
      caption: isStory ? '' : formData.caption,
      hashtags: isStory ? [] : formData.hashtags,
      mediaKeys,
      videoUrl: formData.videoUrl || undefined,
    });
  }, [
    finalMediaType,
    formData.caption,
    formData.carouselAssets,
    formData.contentType,
    formData.hashtags,
    formData.imageUrl,
    formData.videoUrl,
  ]);

  const validationError = validation.ok ? null : validation.errors[0]?.message;

  // Initialize form from post
  useEffect(() => {
    if (!post) return;
    const mediaAssets = post.mediaAssets || [];
    const carouselAssetsFromPost: AssetReference[] = mediaAssets.map((asset) => ({
      id: asset.assetId || asset.cdnUrl,
      url: asset.cdnUrl,
    }));

    // Normalize mediaType from API/DB:
    // If missing, infer from contentType (reel => video, otherwise image).
    const normalizedContentType = (post.contentType as InstagramContentType) || 'post';
    let normalizedMediaType: InstagramMediaType;
    if (post.mediaType === 'video') {
      normalizedMediaType = 'video';
    } else if (post.mediaType === 'image') {
      normalizedMediaType = 'image';
    } else {
      normalizedMediaType = normalizedContentType === 'reel' ? 'video' : 'image';
    }

    setFormData({
      caption: post.caption || '',
      hashtags: stripHashtagPrefixes(post.hashtags || []),
      imageUrl: post.imageUrl || '',
      videoUrl: post.videoUrl || '',
      carouselAssets: carouselAssetsFromPost,
      contentType: normalizedContentType,
      mediaType: normalizedMediaType,
      scheduledAt: formatScheduledInput(post.scheduledAt),
      shareToFeed: normalizedContentType === 'reel' ? (post.shareToFeed ?? true) : true,
    });
    setSelectedCampaign(post.campaign?.id || post.campaignId || null);
    setHasChanges(false);
    formInitializedRef.current = true;
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
  const canScheduleExisting = Boolean(!disabled && post && post.status !== 'scheduled');

  const { mutate: mutateContent, isPending: isSaving } = useMutation({
    mutationFn: async (data: {
      contentId: string;
      caption?: string;
      hashtags?: string[];
      scheduledAt?: string;
      campaignId?: string | null;
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
      setHasChanges(false);
    },
    onError: () => toast.error('Failed to save changes'),
  });

  // Schedule post mutation
  const { mutate: schedulePost, isPending: isScheduling } = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('No post ID');
      if (!formData.scheduledAt) throw new Error('No scheduled time set');

      const scheduledUtc = toUTCFromInput(formData.scheduledAt, brandTimezone).toISOString();
      const isStory = formData.contentType === 'story';

      return contentApi.updateContent({
        contentId: id,
        caption: isStory ? '' : formData.caption.trim(),
        hashtags: isStory ? [] : normalizeHashtags(formData.hashtags),
        campaignId: selectedCampaign || null,
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

      const hashtagArray = Array.from(new Set(normalizeHashtags(formData.hashtags)));

      // Determine final mediaType based on contentType
      // Stories don't support captions or hashtags per Instagram API
      const isStory = formData.contentType === 'story';

      return contentApi.createManualContent({
        brandId: selectedBrand.id,
        caption: isStory ? '' : formData.caption.trim(),
        hashtags: isStory ? [] : hashtagArray,
        videoUrl: formData.videoUrl || undefined,
        assetIds: formData.carouselAssets.map((a) => a.id),
        mediaType: finalMediaType,
        contentType: formData.contentType,
        campaignId: selectedCampaign || undefined,
        shareToFeed: formData.contentType === 'reel' ? formData.shareToFeed : undefined,
        scheduledAt:
          mode === 'schedule' && formData.scheduledAt
            ? toUTCFromInput(formData.scheduledAt, brandTimezone).toISOString()
            : undefined,
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

  useEffect(() => {
    if (!id || !post || !formInitializedRef.current) {
      if (!id) {
        setHasChanges(false);
      }
      return;
    }

    const trimmedCaption = (formData.caption || '').trim();
    const originalCaption = (post.caption || '').trim();

    const scheduledValue = formData.scheduledAt || '';
    const originalScheduled = formatScheduledInput(post.scheduledAt);

    const formHashtags = normalizeHashtags(formData.hashtags);
    const postHashtags = normalizeHashtags(post.hashtags || []);

    const formImage = formData.imageUrl || '';
    const postImage = post.imageUrl || '';
    const formCarouselIds = (formData.carouselAssets || []).map((a) => a.id);
    const postCarouselIds = (post.mediaAssets || []).map((asset) => asset.assetId || asset.cdnUrl);
    const formShareToFeed = formData.shareToFeed ?? true;
    const postShareToFeed =
      (post.contentType as InstagramContentType | undefined) === 'reel'
        ? (post.shareToFeed ?? true)
        : true;

    const changed =
      trimmedCaption !== originalCaption ||
      JSON.stringify(formHashtags) !== JSON.stringify(postHashtags) ||
      scheduledValue !== originalScheduled ||
      formImage !== postImage ||
      JSON.stringify(formCarouselIds) !== JSON.stringify(postCarouselIds) ||
      formShareToFeed !== postShareToFeed;

    setHasChanges(changed);
  }, [formData, id, post]);

  const handleSaveChanges = () => {
    if (!id || !hasChanges) return;

    if (!validation.ok) {
      toast.error(validationError || 'Please fix validation errors before saving');
      return;
    }

    // Persist media changes first when in image mode with carousel assets
    if (finalMediaType === 'image') {
      const assetIds = formData.carouselAssets.map((a) => a.id).filter(Boolean);
      if (assetIds.length > 0) {
        contentApi
          .updateMedia(id, assetIds)
          .catch((error) => {
            console.error('Failed to update post media', error);
            toast.error('Failed to update post images. Please try again.');
          })
          .then(() => {
            // Invalidate post detail so mediaAssets/imageUrl stay in sync
            queryClient.invalidateQueries({ queryKey: ['post', id] });
          });
      }
    }

    const scheduledAtPayload = formData.scheduledAt
      ? toUTCFromInput(formData.scheduledAt, brandTimezone).toISOString()
      : undefined;

    mutateContent({
      contentId: id,
      caption: formData.contentType === 'story' ? '' : (formData.caption || '').trim(),
      hashtags:
        formData.contentType === 'story'
          ? []
          : normalizeHashtags(Array.from(new Set(formData.hashtags))),
      campaignId: selectedCampaign || null,
      ...(scheduledAtPayload ? { scheduledAt: scheduledAtPayload } : {}),
    });
  };

  // Campaign selection state
  const [selectedCampaign, setSelectedCampaign] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(false);

  // Prefill from query params when creating
  const prefillAppliedRef = useRef(false);
  useEffect(() => {
    if (!isCreating || prefillAppliedRef.current === true) return;
    if (!location.search) return;
    const params = new URLSearchParams(location.search);
    const qCaption = params.get('caption');
    const qHashtags = params.get('hashtags');
    const qScheduledAt = params.get('scheduledAt');
    const qCampaignId = params.get('campaignId');
    if (qCaption || qHashtags || qScheduledAt || qCampaignId) {
      setFormData((prev) => ({
        ...prev,
        caption: qCaption ?? prev.caption,
        hashtags: qHashtags
          ? stripHashtagPrefixes(qHashtags.split(/[,\s]+/).filter(Boolean))
          : prev.hashtags,
        scheduledAt: qScheduledAt ? formatScheduledInput(qScheduledAt) : prev.scheduledAt,
      }));
      if (qCampaignId) setSelectedCampaign(qCampaignId);
      prefillAppliedRef.current = true;
    }
  }, [isCreating, location.search]);

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

  const handleCloseSidebar = () => {
    if (layout === 'sidebar') {
      if (!disabled && hasChanges) {
        handleSaveChanges();
      }
      close();
    } else if (onClose) {
      onClose();
    }
  };

  const handleOpenCreatePage = () => {
    if (layout === 'sidebar') {
      close();
    }
    navigate('/posts/create');
  };

  const containerClass = useMemo(
    () => cn('flex flex-col', layout === 'sidebar' ? 'h-full shadow-lg' : 'min-h-[60vh] w-full'),
    [layout]
  );

  const headerClass = useMemo(
    () =>
      cn(
        'bg-card flex h-14 items-center justify-between border-b px-4',
        layout === 'sidebar' ? 'sticky top-0 z-10' : 'rounded-t'
      ),
    [layout]
  );

  const bodyClass =
    layout === 'sidebar' ? 'flex-1 overflow-y-auto px-4 py-3' : 'flex-1 overflow-y-auto px-4 py-4';

  const isVideoMedia = finalMediaType === 'video';

  return (
    <div className={containerClass} role="complementary" aria-labelledby="right-sidebar-title">
      {showHeader ? (
        <div className={headerClass}>
          {id ? (
            <Breadcrumb aria-label="right-sidebar-title">
              <BreadcrumbList>
                <BreadcrumbItem>
                  {isLoading ? (
                    <BreadcrumbPage>Loading…</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link to={disabled ? `/posts/${id}` : `/posts/${id}?edit=1`}>
                        {disabled ? 'View Post' : 'Edit Post'}
                      </Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          ) : (
            <Breadcrumb aria-label="right-sidebar-title">
              <BreadcrumbList>
                <BreadcrumbItem>
                  {layout === 'sidebar' ? (
                    <BreadcrumbLink asChild>
                      <Link to="/posts/create" onClick={handleOpenCreatePage}>
                        Create New Post
                      </Link>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>Create New Post</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          )}
          {layout === 'sidebar' ? (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCloseSidebar}
                aria-label="Close sidebar"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {layout === 'sidebar' && showHeader ? <Separator /> : null}
      <div className={bodyClass}>
        {isCreating ? (
          // Creation mode
          <div className="space-y-4">
            {!selectedBrand ? (
              <AppEmptyState
                variant="minimal"
                title="Select a brand to create this post"
                description="Post drafts, scheduling rules, and insights are tied to the brand you choose."
                actions={[{ label: 'Choose Brand', to: '/brands' }]}
                className="min-h-[280px]"
              />
            ) : (
              <>
                {/* Post Type Selector */}
                <div className="space-y-2">
                  <Label className="text-sm">Content Type</Label>
                  <RadioGroup
                    value={formData.contentType}
                    onValueChange={(value) =>
                      setFormData((s) => ({
                        ...s,
                        contentType: value as InstagramContentType,
                        // Reset mediaType to video if reel is selected
                        mediaType: value === 'reel' ? 'video' : s.mediaType,
                      }))
                    }
                    className="flex gap-2"
                  >
                    <div className="flex-1">
                      <RadioGroupItem value="post" id="type-post" className="peer sr-only" />
                      <Label
                        htmlFor="type-post"
                        className="hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-accent/50 border-input bg-background flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-all"
                      >
                        <ImageIcon className="h-3.5 w-3.5" />
                        <span>Post</span>
                      </Label>
                    </div>
                    <div className="flex-1">
                      <RadioGroupItem value="reel" id="type-reel" className="peer sr-only" />
                      <Label
                        htmlFor="type-reel"
                        className="hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-accent/50 border-input bg-background flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-all"
                      >
                        <Film className="h-3.5 w-3.5" />
                        <span>Reel</span>
                      </Label>
                    </div>
                    <div className="flex-1">
                      <RadioGroupItem value="story" id="type-story" className="peer sr-only" />
                      <Label
                        htmlFor="type-story"
                        className="hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-accent/50 border-input bg-background flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-all"
                      >
                        <Zap className="h-3.5 w-3.5" />
                        <span>Story</span>
                      </Label>
                    </div>
                  </RadioGroup>
                </div>

                {/* Media Upload - unified media uploader or video-only for Reels */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Upload className="h-4 w-4" />
                    {formData.contentType === 'reel' ? 'Video' : 'Media'}
                    {formData.contentType === 'reel' && (
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button type="button" variant="ghost" size="icon" className="h-6 w-6 p-0">
                            <HelpCircle className="text-muted-foreground h-4 w-4" />
                            <span className="sr-only">Instagram reel video requirements</span>
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-lg">
                          <DialogHeader>
                            <DialogTitle>Instagram reel video requirements</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-3 text-sm">
                            <p>
                              To avoid Instagram media processing errors, try to match these
                              guidelines when uploading a reel video:
                            </p>
                            <ul className="list-disc space-y-1 pl-5">
                              <li>
                                <strong>Resolution:</strong> minimum{' '}
                                <span className="font-mono">540×960</span>, recommended{' '}
                                <span className="font-mono">1080×1920</span> (Full HD vertical)
                              </li>
                              <li>
                                <strong>Aspect ratio:</strong> vertical{' '}
                                <span className="font-mono">9:16</span> (Instagram also accepts
                                square <span className="font-mono">1:1</span> and portrait{' '}
                                <span className="font-mono">4:5</span>)
                              </li>
                              <li>
                                <strong>Length:</strong> between 3 and 90 seconds
                              </li>
                              <li>
                                <strong>File size:</strong> up to 300MB per video
                              </li>
                              <li>
                                <strong>Formats:</strong> MP4 or MOV using common codecs
                                (H.264/HEVC)
                              </li>
                            </ul>
                            <p className="text-muted-foreground text-xs">
                              If your video falls outside these ranges, Instagram may reject or fail
                              to process it. Re-export from your editor using a vertical 1080×1920
                              preset for best results.
                            </p>
                          </div>
                        </DialogContent>
                      </Dialog>
                    )}
                  </Label>

                  {/* Reels can only be video */}
                  {formData.contentType === 'reel' ? (
                    <div className="space-y-2">
                      {selectedBrand?.id && (
                        <>
                          <VideoUploader
                            value={formData.videoUrl}
                            onChange={(url) => setFormData((s) => ({ ...s, videoUrl: url }))}
                            brandId={selectedBrand.id}
                            maxSizeInMB={300}
                            acceptedFormats={['video/mp4', 'video/quicktime', 'video/mpeg']}
                            minDurationSeconds={3}
                            maxDurationSeconds={90}
                            minWidth={540}
                            minHeight={960}
                            maxWidth={1920}
                            maxHeight={1920}
                            allowedAspectRatios={[
                              { label: '9:16', width: 9, height: 16 },
                              { label: '4:5', width: 4, height: 5 },
                              { label: '1:1', width: 1, height: 1 },
                            ]}
                          />
                          <p className="text-muted-foreground text-sm">
                            Upload a vertical video for your reel (max 300MB, 9:16 aspect ratio
                            recommended)
                          </p>
                          <div className="border-border bg-muted/40 flex items-center justify-between rounded-md border px-3 py-2">
                            <div className="space-y-0.5">
                              <Label htmlFor="share-to-feed-toggle" className="text-xs font-medium">
                                Share to Feed
                              </Label>
                              <p className="text-muted-foreground text-xs">
                                When enabled, this reel appears in both your feed grid and the Reels
                                tab.
                              </p>
                            </div>
                            <Switch
                              id="share-to-feed-toggle"
                              checked={formData.shareToFeed}
                              onCheckedChange={(checked) =>
                                setFormData((s) => ({ ...s, shareToFeed: checked }))
                              }
                            />
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    /* Posts and Stories can be image(s) or video; detect media type automatically */
                    <>
                      {selectedBrand?.id && (
                        <MultiImageUploader
                          value={formData.carouselAssets}
                          onChange={(assets) => {
                            setFormData((s) => ({
                              ...s,
                              carouselAssets: assets,
                              mediaType: assets.length > 0 ? 'image' : s.mediaType,
                              // Clear any video when switching to images
                              videoUrl: assets.length > 0 ? '' : s.videoUrl,
                            }));
                          }}
                          brandId={selectedBrand.id}
                          maxImages={10}
                          maxSizeInMB={10}
                          videoUrl={formData.videoUrl}
                          onVideoChange={(url) => {
                            setFormData((s) => ({
                              ...s,
                              videoUrl: url,
                              mediaType: url ? 'video' : s.mediaType,
                              // Clear carousel assets when switching to video
                              carouselAssets: url ? [] : s.carouselAssets,
                            }));
                          }}
                          maxVideoSizeInMB={300}
                          acceptedVideoFormats={['video/mp4', 'video/quicktime', 'video/mpeg']}
                        />
                      )}
                    </>
                  )}
                </div>

                {/* Caption and Hashtags - Not supported for Stories */}
                {formData.contentType !== 'story' && (
                  <>
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
                  </>
                )}

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
                  {!validation.ok && (
                    <p className="text-destructive text-sm">
                      {validationError || 'Please fix validation errors before continuing.'}
                    </p>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => createPost('draft')}
                      disabled={isCreatingPost || !validation.ok}
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
                      disabled={isCreatingPost || !validation.ok || !hasScheduleTime}
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
            <PostStatusCard
              status={(post.status as PostStatus) || 'draft'}
              createdAt={post.createdAt || post.updatedAt || new Date().toISOString()}
              processing={Boolean(post.generationParams?.processing?.active)}
              errorMessage={post.schedulingError || null}
            />

            <div className="space-y-2">
              <Label>{isVideoMedia ? 'Video' : 'Post Image'}</Label>
              {isVideoMedia ? (
                formData.videoUrl ? (
                  <div className="bg-muted overflow-hidden rounded-lg">
                    <video
                      src={formData.videoUrl}
                      className="h-auto max-h-[250px] w-full object-cover"
                      controls
                    />
                  </div>
                ) : (
                  <div className="text-muted-foreground text-sm">No video</div>
                )
              ) : formData.imageUrl ? (
                <div className="bg-muted overflow-hidden rounded-lg">
                  <img
                    src={formData.imageUrl}
                    alt="Post content"
                    className="h-auto max-h-[250px] w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              ) : (
                <div className="text-muted-foreground text-sm">No image</div>
              )}
              {!disabled && (
                <div className="flex flex-col gap-2">
                  <p className="text-muted-foreground text-xs">
                    {isVideoMedia
                      ? 'Change the video for this post by selecting an asset from your library.'
                      : 'Change the image for this post by selecting an asset from your library.'}
                  </p>
                  {post?.brand?.id && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowAssetPicker(true)}
                    >
                      Choose from Assets
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Caption and Hashtags - Not supported for Stories */}
            {formData.contentType !== 'story' && (
              <>
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
              </>
            )}

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
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                  {!validation.ok && (
                    <p className="text-destructive text-sm">
                      {validationError || 'Please fix validation errors before continuing.'}
                    </p>
                  )}
                  <Button
                    onClick={handleSaveChanges}
                    disabled={!hasChanges || isSaving || !validation.ok}
                  >
                    {isSaving ? (
                      <>
                        <Save className="mr-2 h-4 w-4 animate-pulse" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save Changes
                      </>
                    )}
                  </Button>
                  {canScheduleExisting && (
                    <Button
                      onClick={() => schedulePost()}
                      disabled={isScheduling || !validation.ok || !hasScheduleTime}
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
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {showAssetPicker && post?.brand?.id && (
        <AssetPicker
          brandId={post.brand.id}
          onSelect={async (asset) => {
            try {
              await contentApi.attachAsset(post.id, asset.id);
              setFormData((s) => ({
                ...s,
                imageUrl: asset.url,
              }));
              queryClient.setQueryData(['post', id], (oldData: PostDetailData | undefined) => {
                if (!oldData) return oldData;
                return {
                  ...oldData,
                  imageUrl: asset.url,
                };
              });
            } catch (error) {
              console.error('Failed to attach asset to post', error);
              toast.error('Failed to attach asset. Please try again.');
            } finally {
              setShowAssetPicker(false);
            }
          }}
          onClose={() => setShowAssetPicker(false)}
        />
      )}
    </div>
  );
}
