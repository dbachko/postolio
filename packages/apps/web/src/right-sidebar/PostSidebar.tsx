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
import { MultiImageUploader, type AssetReference } from '@/components/MultiImageUploader';
import { VideoUploader } from '@/components/VideoUploader';
import { PostCaptionEditor } from '@/components/PostCaptionEditor';
import { PostScheduler } from '@/components/PostScheduler';
import type { PostStatus } from '@/components/PostStatusCard';
import { PostSidebarStatusPanel } from './PostSidebarStatusPanel';
import { ChooseFromAssetsButton } from '@/components/ChooseFromAssetsButton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useTimezone } from '@/contexts/TimezoneContext';
import { toUTCFromInput, getUserTimezone } from '@/lib/timezone';
import { formatInTimeZone } from 'date-fns-tz';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { X, Clock, Save, Upload, Calendar, Image as ImageIcon, Film, Zap } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { AppEmptyState } from '@/components/AppEmptyState';
import {
  validateContentPayload,
  type InstagramContentType,
  type InstagramMediaType,
} from '@postolio/content-validation';
import AssetPicker from '@/features/assets/components/AssetPicker';
import { Switch } from '@/components/ui/switch';
import { assetsApi } from '@/features/assets/api/client';

interface PostDetailData {
  id: string;
  caption: string;
  imageUrl?: string;
  videoUrl?: string;
  mediaType?: string;
  contentType?: string;
  shareToFeed?: boolean | null;
  status: string; // 'draft' | 'scheduled' | 'published' | ...
  scheduledAt?: string;
  postedAt?: string;
  brandId?: string;
  brand: { id: string; name: string };
  mediaAssets?: { cdnUrl: string; usageContext: string; displayOrder: number; assetId?: string }[];
  schedulingError?: string | null;
  createdAt?: string;
  updatedAt?: string;
  instagramPermalink?: string;
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

const formatScheduledInput = (value?: string, timezone?: string) => {
  if (!value) return '';
  const effectiveTimezone = timezone || getUserTimezone();
  return formatInTimeZone(new Date(value), effectiveTimezone, "yyyy-MM-dd'T'HH:mm");
};

const deriveMediaTypeFromAssets = (
  assets: AssetReference[],
  fallbackVideoUrl?: string
): InstagramMediaType => {
  if (assets.length > 1) return 'image';
  if (assets.length === 1) {
    return assets[0]?.type === 'video' ? 'video' : 'image';
  }
  if (fallbackVideoUrl) return 'video';
  return 'image';
};

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
    if (formData.contentType === 'reel') return 'video';
    return deriveMediaTypeFromAssets(formData.carouselAssets, formData.videoUrl);
  }, [formData.carouselAssets, formData.contentType, formData.videoUrl]);

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
      mediaKeys,
      videoUrl: formData.videoUrl || undefined,
    });
  }, [
    finalMediaType,
    formData.caption,
    formData.carouselAssets,
    formData.contentType,
    formData.imageUrl,
    formData.videoUrl,
  ]);

  const validationError = validation.ok ? null : validation.errors[0]?.message;

  const brandIdForAssets = post?.brand?.id ?? selectedBrand?.id ?? null;

  // Initialize form from post (wait for brandTimezone to be loaded)
  useEffect(() => {
    if (!post || !brandTimezone) return;
    const mediaAssets = post.mediaAssets || [];
    const carouselAssetsFromPost: AssetReference[] = mediaAssets.map((asset) => ({
      id: asset.assetId || asset.cdnUrl,
      url: asset.cdnUrl,
    }));

    // Normalize mediaType from API/DB:
    // If missing, infer from contentType (reel => video, otherwise image).
    const normalizedContentType = (post.contentType as InstagramContentType) || 'post';

    setFormData({
      caption: post.caption || '',
      imageUrl: post.imageUrl || '',
      videoUrl: post.videoUrl || '',
      carouselAssets: carouselAssetsFromPost,
      contentType: normalizedContentType,
      mediaType: deriveMediaTypeFromAssets(carouselAssetsFromPost, post.videoUrl || undefined),
      scheduledAt: formatScheduledInput(post.scheduledAt, brandTimezone),
      shareToFeed: normalizedContentType === 'reel' ? (post.shareToFeed ?? true) : true,
    });
    setSelectedCampaign(post.campaign?.id || post.campaignId || null);
    setHasChanges(false);
    formInitializedRef.current = true;
  }, [post, brandTimezone]);

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

      // Determine final mediaType based on contentType
      // Stories don't support captions or hashtags per Instagram API
      const isStory = formData.contentType === 'story';

      return contentApi.createManualContent({
        brandId: selectedBrand.id,
        caption: isStory ? '' : formData.caption.trim(),
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
    const originalScheduled = formatScheduledInput(post.scheduledAt, brandTimezone);

    const formImage = formData.imageUrl || '';
    const postImage = post.imageUrl || '';
    const formVideo = formData.videoUrl || '';
    const postVideo = post.videoUrl || '';
    const formCarouselIds = (formData.carouselAssets || []).map((a) => a.id);
    const postCarouselIds = (post.mediaAssets || []).map((asset) => asset.assetId || asset.cdnUrl);
    const formShareToFeed = formData.shareToFeed ?? true;
    const postShareToFeed =
      (post.contentType as InstagramContentType | undefined) === 'reel'
        ? (post.shareToFeed ?? true)
        : true;

    const changed =
      trimmedCaption !== originalCaption ||
      scheduledValue !== originalScheduled ||
      formImage !== postImage ||
      formVideo !== postVideo ||
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
      campaignId: selectedCampaign || null,
      ...(scheduledAtPayload ? { scheduledAt: scheduledAtPayload } : {}),
    });
  };

  // Campaign selection state
  const [selectedCampaign, setSelectedCampaign] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(false);

  // Parse query params for prefill
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const qCaption = searchParams.get('caption');
  const qScheduledAt = searchParams.get('scheduledAt');
  const qCampaignId = searchParams.get('campaignId');
  const qAssetId = searchParams.get('assetId');
  const qAssetIdsParam = searchParams.get('assetIds');
  const prefillAssetIds = useMemo(() => {
    const ids = new Set<string>();
    if (qAssetId) ids.add(qAssetId);
    if (qAssetIdsParam) {
      qAssetIdsParam
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .forEach((id) => ids.add(id));
    }
    return Array.from(ids);
  }, [qAssetId, qAssetIdsParam]);

  // Optional asset prefill via React Query (images & videos)
  const { data: prefillAssets, isLoading: isPrefillAssetsLoading } = useQuery({
    queryKey: ['prefill-assets', prefillAssetIds.join(',')],
    enabled: isCreating && prefillAssetIds.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        prefillAssetIds.map(async (id) => {
          try {
            const { asset } = await assetsApi.getAsset(id);
            return asset;
          } catch {
            return null;
          }
        })
      );
      return results.filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
    },
    retry: 0,
  });

  // Prefill from query params when creating
  const prefillAppliedRef = useRef(false);
  useEffect(() => {
    if (!isCreating || prefillAppliedRef.current === true) return;
    const hasPrefillInput =
      Boolean(qCaption) ||
      Boolean(qScheduledAt) ||
      Boolean(qCampaignId) ||
      prefillAssetIds.length > 0;
    if (!hasPrefillInput) {
      return;
    }

    // If we have assetIds, wait until the query finishes (success or error)
    if (prefillAssetIds.length > 0 && isPrefillAssetsLoading) {
      return;
    }

    const normalizedAssets: AssetReference[] =
      prefillAssets?.map((asset) => ({
        id: asset.id,
        url: asset.thumbnailUrl || asset.url,
        type: asset.fileType === 'video' ? ('video' as const) : ('image' as const),
      })) ?? [];
    const nextAssets = normalizedAssets.slice(0, 10) as AssetReference[];

    setFormData((prev) => {
      const nextMediaType = nextAssets.length
        ? deriveMediaTypeFromAssets(nextAssets)
        : prev.mediaType;
      const firstAsset = nextAssets[0];

      return {
        ...prev,
        caption: qCaption ?? prev.caption,
        scheduledAt: qScheduledAt ? formatScheduledInput(qScheduledAt) : prev.scheduledAt,
        ...(nextAssets.length
          ? {
              carouselAssets: nextAssets,
              mediaType: nextMediaType,
              videoUrl:
                nextAssets.length === 1 && nextAssets[0]?.type === 'video' ? nextAssets[0].url : '',
              imageUrl: firstAsset?.url || prev.imageUrl,
            }
          : {}),
      };
    });
    if (qCampaignId) setSelectedCampaign(qCampaignId);
    prefillAppliedRef.current = true;
  }, [
    isCreating,
    qCaption,
    qScheduledAt,
    qCampaignId,
    prefillAssetIds,
    isPrefillAssetsLoading,
    prefillAssets,
  ]);

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

  // Allow mixed media for all non-reel content; reels must remain video-only.
  const allowMixedMedia = formData.contentType !== 'reel';
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
                    Media <span className="text-destructive">*</span>
                  </Label>

                  {/* Reels can only be video */}
                  {formData.contentType === 'reel' ? (
                    <div className="space-y-3">
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
                            headline="Drop reel video here, or click to browse"
                            subtext="Reels: MP4/MOV/MPEG · 3–90s · max 300MB"
                          />
                          <ChooseFromAssetsButton onClick={() => setShowAssetPicker(true)} />
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
                        <>
                          <MultiImageUploader
                            value={formData.carouselAssets}
                            onChange={(assets) => {
                              setFormData((s) => {
                                const nextMediaType = deriveMediaTypeFromAssets(assets, s.videoUrl);
                                const shouldClearVideoUrl =
                                  !allowMixedMedia &&
                                  assets.length > 0 &&
                                  nextMediaType !== 'video';

                                return {
                                  ...s,
                                  carouselAssets: assets,
                                  mediaType: nextMediaType,
                                  videoUrl: shouldClearVideoUrl ? '' : s.videoUrl,
                                };
                              });
                            }}
                            brandId={selectedBrand.id}
                            maxImages={10}
                            maxSizeInMB={10}
                            videoUrl={allowMixedMedia ? undefined : formData.videoUrl}
                            onVideoChange={(url) => {
                              setFormData((s) => ({
                                ...s,
                                videoUrl: url,
                                mediaType: deriveMediaTypeFromAssets(s.carouselAssets, url),
                                // For non-mixed flows, clear images when switching to video
                                carouselAssets: allowMixedMedia
                                  ? s.carouselAssets
                                  : url
                                    ? []
                                    : s.carouselAssets,
                              }));
                            }}
                            maxVideoSizeInMB={300}
                            acceptedVideoFormats={['video/mp4', 'video/quicktime', 'video/mpeg']}
                            allowMixedMedia={allowMixedMedia}
                            onChooseFromAssets={() => setShowAssetPicker(true)}
                          />
                        </>
                      )}
                    </>
                  )}
                </div>

                {/* Caption - Not supported for Stories */}
                {formData.contentType !== 'story' && (
                  <>
                    <PostCaptionEditor
                      value={formData.caption}
                      onChange={(v) => setFormData((s) => ({ ...s, caption: v }))}
                      brandId={selectedBrand?.id}
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
                  <TooltipProvider>
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
                      <Tooltip>
                        <TooltipTrigger asChild>
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
                        </TooltipTrigger>
                        {!validation.ok && (
                          <TooltipContent>
                            <p className="text-sm">
                              {validationError || 'Please fix validation errors before continuing.'}
                            </p>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </div>
                  </TooltipProvider>
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
            <PostSidebarStatusPanel
              status={(post.status as PostStatus) || 'draft'}
              processing={Boolean(post.generationParams?.processing?.active)}
              schedulingError={post.schedulingError || null}
              instagramPermalink={post.instagramPermalink}
              brandTimezone={brandTimezone}
              scheduledAt={post.scheduledAt}
            />

            <div className="space-y-2">
              <Label>{isVideoMedia ? 'Video' : 'Post Media'}</Label>
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
              ) : (
                <div className="space-y-2">
                  {post?.brand?.id && (
                    <MultiImageUploader
                      value={formData.carouselAssets}
                      onChange={(assets) => {
                        setFormData((s) => ({
                          ...s,
                          carouselAssets: assets,
                          imageUrl: assets[0]?.url || '',
                          mediaType: deriveMediaTypeFromAssets(assets, s.videoUrl),
                          videoUrl: !allowMixedMedia && assets.length > 0 ? '' : s.videoUrl,
                        }));
                      }}
                      brandId={post.brand.id}
                      maxImages={10}
                      maxSizeInMB={10}
                      enableUpload={false}
                      allowMixedMedia={allowMixedMedia}
                    />
                  )}
                  {!formData.carouselAssets.length && (
                    <div className="text-muted-foreground text-sm">No image</div>
                  )}
                </div>
              )}
              {!disabled && (
                <div className="flex flex-col gap-2">
                  {post?.brand?.id && (
                    <ChooseFromAssetsButton
                      onClick={() => setShowAssetPicker(true)}
                      size="compact"
                      fullWidth={false}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Caption - Not supported for Stories */}
            {formData.contentType !== 'story' && (
              <>
                <PostCaptionEditor
                  value={formData.caption}
                  onChange={(v) => setFormData((s) => ({ ...s, caption: v }))}
                  brandId={post?.brand?.id}
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
                <TooltipProvider>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
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
                      <Tooltip>
                        <TooltipTrigger asChild>
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
                        </TooltipTrigger>
                        {!validation.ok && (
                          <TooltipContent>
                            <p className="text-sm">
                              {validationError || 'Please fix validation errors before continuing.'}
                            </p>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    )}
                  </div>
                </TooltipProvider>
              </div>
            )}
          </div>
        )}
      </div>
      {showAssetPicker && brandIdForAssets && (
        <AssetPicker
          brandId={brandIdForAssets}
          type={formData.contentType === 'reel' ? 'video' : undefined}
          onSelectMany={(assets) => {
            const normalized: AssetReference[] = assets.map((asset) => ({
              id: asset.id,
              url: asset.thumbnailUrl || asset.url,
              type: asset.fileType === 'video' ? ('video' as const) : ('image' as const),
            }));
            const allowMixing = formData.contentType === 'post';

            if (!allowMixing) {
              const firstVideo = normalized.find((asset) => asset.type === 'video');
              const imageAssets = normalized.filter((asset) => asset.type !== 'video');

              if (firstVideo) {
                setFormData((s) => ({
                  ...s,
                  carouselAssets: [],
                  imageUrl: '',
                  mediaType: 'video',
                  videoUrl: firstVideo.url,
                }));
              } else {
                setFormData((s) => ({
                  ...s,
                  carouselAssets: imageAssets.slice(0, 10),
                  imageUrl: imageAssets[0]?.url || '',
                  mediaType: 'image',
                  videoUrl: '',
                }));
              }
              setShowAssetPicker(false);
              return;
            }

            const merged = (() => {
              const seen = new Set<string>();
              const combined = [...formData.carouselAssets, ...normalized];
              const result: AssetReference[] = [];
              for (const item of combined) {
                const key = item.id || item.url;
                if (seen.has(key)) continue;
                seen.add(key);
                result.push(item);
                if (result.length >= 10) break;
              }
              return result;
            })();

            const nextMediaType = deriveMediaTypeFromAssets(merged);
            const firstAsset = merged[0];
            const firstVideo = merged.find((asset) => asset.type === 'video');

            setFormData((s) => ({
              ...s,
              carouselAssets: merged,
              imageUrl: firstAsset?.url || s.imageUrl,
              mediaType: nextMediaType,
              videoUrl:
                !allowMixing && merged.length === 1 && merged[0]?.type === 'video'
                  ? merged[0].url
                  : allowMixing
                    ? firstVideo?.url || ''
                    : '',
            }));
            setShowAssetPicker(false);
          }}
          onClose={() => setShowAssetPicker(false)}
        />
      )}
    </div>
  );
}
