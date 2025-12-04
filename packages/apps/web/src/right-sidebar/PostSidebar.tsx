import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { MultiImageUploader, type AssetReference } from '@/components/MultiImageUploader';
import { VideoUploader } from '@/components/VideoUploader';
import { PostCaptionEditor } from '@/components/PostCaptionEditor';
import type { PostStatus } from '@/components/PostStatusCard';
import { PostSidebarStatusPanel } from './PostSidebarStatusPanel';
import { ChooseFromAssetsButton } from '@/components/ChooseFromAssetsButton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTimezone } from '@/contexts/TimezoneContext';
import { toUTCFromInput, getUserTimezone } from '@/lib/timezone';
import { formatInTimeZone } from 'date-fns-tz';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import {
  X,
  Clock,
  Save,
  Upload,
  Image as ImageIcon,
  Film,
  Zap,
  AlertTriangle,
  ChevronDown,
  Megaphone,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTrigger,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { Campaign } from '@/lib/api';

function getScheduleBlockerMessage(params: {
  atCapacity: boolean;
  limitMessage: string;
  validationOk: boolean;
  validationError: string | null;
  hasScheduleTime: boolean;
  pausedCampaign: boolean;
}): string | null {
  const {
    atCapacity,
    limitMessage,
    validationOk,
    validationError,
    hasScheduleTime,
    pausedCampaign,
  } = params;
  if (pausedCampaign) {
    return 'This campaign is paused. Resume it before scheduling new posts.';
  }
  if (atCapacity) return limitMessage || 'You have reached your scheduling limit.';
  if (!validationOk) return validationError || 'Please fix validation errors before continuing.';
  if (!hasScheduleTime) return 'Pick a time before scheduling.';
  return null;
}

interface PostDetailData {
  id: string;
  caption: string;
  imageUrl?: string;
  videoUrl?: string;
  mediaType?: string;
  contentType?: string;
  shareToFeed?: boolean | null;
  firstComment?: string | null;
  firstCommentStatus?: 'pending' | 'posted' | 'failed' | 'retrying' | null;
  firstCommentPostedAt?: string | null;
  firstCommentError?: string | null;
  status: string; // 'draft' | 'scheduled' | 'published' | ...
  scheduledAt?: string;
  postedAt?: string;
  brandId?: string;
  brand: { id: string; name: string };
  mediaAssets?: {
    cdnUrl: string;
    usageContext: string;
    displayOrder: number;
    assetId?: string;
    fileType?: 'image' | 'video';
  }[];
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

const inferAssetTypeFromUrl = (url?: string | null): 'image' | 'video' => {
  if (!url) return 'image';
  const lower = url.toLowerCase();
  if (/\.(mp4|mov|m4v|webm|mpeg|mpg|avi|qt)/.test(lower)) return 'video';
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
    firstComment: '',
  });
  const [hasChanges, setHasChanges] = useState(false);
  const formInitializedRef = useRef(false);
  const hasScheduleTime = Boolean(formData.scheduledAt);
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [firstCommentOpen, setFirstCommentOpen] = useState(false);

  const finalMediaType = useMemo<InstagramMediaType>(() => {
    if (formData.contentType === 'reel') return 'video';
    return deriveMediaTypeFromAssets(formData.carouselAssets, formData.videoUrl);
  }, [formData.carouselAssets, formData.contentType, formData.videoUrl]);

  const validation = useMemo(() => {
    const isStory = formData.contentType === 'story';
    const mediaAssets: { key: string; type: InstagramMediaType }[] =
      formData.carouselAssets && formData.carouselAssets.length > 0
        ? formData.carouselAssets.map((a) => ({
            key: a.url,
            type:
              a.type === 'video'
                ? ('video' as InstagramMediaType)
                : ('image' as InstagramMediaType),
          }))
        : (() => {
            const assets: { key: string; type: InstagramMediaType }[] = [];
            if (formData.videoUrl) {
              assets.push({ key: formData.videoUrl, type: 'video' });
            } else if (formData.imageUrl) {
              assets.push({ key: formData.imageUrl, type: 'image' });
            }
            return assets;
          })();

    return validateContentPayload({
      platform: 'instagram',
      contentType: formData.contentType,
      mediaType: finalMediaType,
      caption: isStory ? '' : formData.caption,
      mediaAssets,
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

  // Scheduling capacity (plan limits)
  const limitsQuery = useQuery({
    queryKey: ['limits', 'schedule-ahead'],
    queryFn: () => campaignApi.getScheduleAheadLimit(),
    staleTime: 60 * 1000,
  });
  const limits = limitsQuery.data?.data as
    | { tier: string; maxAllowed: number; currentCount: number }
    | undefined;
  const atCapacity =
    !!limits && Number.isFinite(limits.maxAllowed) && limits.currentCount >= limits.maxAllowed;
  const limitMessage = atCapacity
    ? `Scheduling limit reached (${limits?.currentCount}/${limits?.maxAllowed}). Upgrade to add more.`
    : '';

  // Initialize form from post (wait for brandTimezone to be loaded)
  useEffect(() => {
    if (!post || !brandTimezone) return;
    const mediaAssets = post.mediaAssets || [];
    const carouselAssetsFromPost: AssetReference[] = mediaAssets.map((asset) => {
      const type =
        asset.fileType === 'video'
          ? ('video' as const)
          : asset.fileType === 'image'
            ? ('image' as const)
            : inferAssetTypeFromUrl(asset.cdnUrl);
      return {
        id: asset.assetId || asset.cdnUrl,
        url: asset.cdnUrl,
        type,
      };
    });
    const videoAsset = carouselAssetsFromPost.find((a) => a.type === 'video');

    // Normalize mediaType from API/DB:
    // If missing, infer from contentType (reel => video, otherwise image).
    const normalizedContentType = (post.contentType as InstagramContentType) || 'post';
    const normalizedVideoUrl = post.videoUrl || videoAsset?.url || '';

    setFormData({
      caption: post.caption || '',
      imageUrl: post.imageUrl || '',
      videoUrl: normalizedVideoUrl,
      carouselAssets: carouselAssetsFromPost,
      contentType: normalizedContentType,
      mediaType: deriveMediaTypeFromAssets(carouselAssetsFromPost, normalizedVideoUrl || undefined),
      scheduledAt: formatScheduledInput(post.scheduledAt, brandTimezone),
      shareToFeed: normalizedContentType === 'reel' ? (post.shareToFeed ?? true) : true,
      firstComment: (post as any).firstComment || '',
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
  const isScheduled = post?.status === 'scheduled';

  const minScheduleInput = useMemo(
    () => formatInTimeZone(new Date(), brandTimezone, "yyyy-MM-dd'T'HH:mm"),
    [brandTimezone]
  );

  const getScheduleErrorMessage = (
    error: any,
    fallback: string = 'Failed to schedule post. Please try again.'
  ): string => {
    if (error?.data?.errors && Array.isArray(error.data.errors) && error.data.errors[0]) {
      return error.data.errors[0];
    }
    if (error?.data?.error) return error.data.error;
    if (typeof error?.message === 'string' && error.message) return error.message;
    return fallback;
  };

  const { mutate: mutateContent, isPending: isSaving } = useMutation({
    mutationFn: async (data: {
      contentId: string;
      caption?: string;
      scheduledAt?: string | null;
      campaignId?: string | null;
      firstComment?: string;
      mediaType?: InstagramMediaType;
      contentType?: InstagramContentType;
      videoUrl?: string;
      shareToFeed?: boolean;
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

  const { mutate: unschedulePost, isPending: isUnscheduling } = useMutation({
    mutationFn: async (contentId: string) => {
      return contentApi.updateContent({
        contentId,
        scheduledAt: null,
      });
    },
    onSuccess: (response, contentId) => {
      toast.success('Post unscheduled and moved to Drafts');
      queryClient.setQueryData(['post', contentId], (oldData: PostDetailData | undefined) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          ...response.content,
          status: response.content?.status || 'draft',
        } as PostDetailData;
      });

      const brandId = response.content?.brandId || post?.brand?.id;
      if (brandId) {
        queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
        queryClient.invalidateQueries({ queryKey: ['drafts', brandId] });
      }
      setHasChanges(false);
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.error ||
        error?.message ||
        'Failed to unschedule post. Please try again.';
      toast.error(message);
    },
  });

  // Create post mutation (for creation mode)
  const { mutate: createPost, isPending: isCreatingPost } = useMutation({
    mutationFn: async (mode: 'draft' | 'schedule') => {
      if (!selectedBrand) throw new Error('No brand selected');

      // Determine final mediaType based on contentType
      // Stories don't support captions or hashtags per Instagram API
      const isStory = formData.contentType === 'story';

      const scheduledUtc =
        mode === 'schedule' && formData.scheduledAt
          ? toUTCFromInput(formData.scheduledAt, brandTimezone)
          : null;

      if (mode === 'schedule') {
        if (!scheduledUtc) throw new Error('Scheduled time required');
        if (scheduledUtc.getTime() <= Date.now()) {
          throw new Error('Scheduled time must be in the future');
        }
      }

      return contentApi.createManualContent({
        brandId: selectedBrand.id,
        caption: isStory ? '' : formData.caption.trim(),
        videoUrl: formData.videoUrl || undefined,
        assetIds: formData.carouselAssets.map((a) => a.id),
        mediaType: finalMediaType,
        contentType: formData.contentType,
        campaignId: selectedCampaign || undefined,
        shareToFeed: formData.contentType === 'reel' ? formData.shareToFeed : undefined,
        firstComment: formData.firstComment?.trim() || undefined,
        scheduledAt: scheduledUtc ? scheduledUtc.toISOString() : undefined,
      });
    },
    onSuccess: (_response, mode) => {
      queryClient.invalidateQueries({ queryKey: ['content'] });
      queryClient.invalidateQueries({ queryKey: ['calendar'] });

      const isScheduled = mode === 'schedule';
      const hasCampaign = !!selectedCampaign;

      let message = 'Post created successfully!';
      if (isScheduled && hasCampaign) {
        message = 'Scheduling started and added to campaign';
      } else if (isScheduled) {
        message = 'Scheduling started';
      } else if (hasCampaign) {
        message = 'Post created and added to campaign!';
      }

      toast.success(message, {
        description: isScheduled
          ? 'We will move it to Scheduled once the scheduler confirms it.'
          : 'You can find it in the content calendar as a draft',
      });

      // Navigate to content calendar where they can see the post
      navigate('/content');
      close();
    },
    onError: (error: Error) => {
      console.error('Failed to create post:', error);
      toast.error(getScheduleErrorMessage(error, 'Failed to create post. Please try again.'));
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
    const postVideo =
      post.videoUrl || post.mediaAssets?.find((asset) => asset.fileType === 'video')?.cdnUrl || '';
    const formCarouselIds = (formData.carouselAssets || []).map((a) => a.id);
    const postCarouselIds = (post.mediaAssets || []).map((asset) => asset.assetId || asset.cdnUrl);
    const formShareToFeed = formData.shareToFeed ?? true;
    const postShareToFeed =
      (post.contentType as InstagramContentType | undefined) === 'reel'
        ? (post.shareToFeed ?? true)
        : true;

    const formFirstComment = (formData.firstComment || '').trim();
    const postFirstComment = ((post as any).firstComment || '').trim();

    const changed =
      trimmedCaption !== originalCaption ||
      scheduledValue !== originalScheduled ||
      formImage !== postImage ||
      formVideo !== postVideo ||
      JSON.stringify(formCarouselIds) !== JSON.stringify(postCarouselIds) ||
      formShareToFeed !== postShareToFeed ||
      formFirstComment !== postFirstComment;

    setHasChanges(changed);
  }, [formData, id, post]);

  const mediaChanged = useMemo(() => {
    if (!post) return false;
    const formCarouselIds = (formData.carouselAssets || []).map((a) => a.id);
    const postCarouselIds = (post.mediaAssets || []).map((asset) => asset.assetId || asset.cdnUrl);
    const formVideo = formData.videoUrl || '';
    const postVideo =
      post.videoUrl || post.mediaAssets?.find((asset) => asset.fileType === 'video')?.cdnUrl || '';
    const formImage = formData.imageUrl || '';
    const postImage = post.imageUrl || '';

    return (
      JSON.stringify(formCarouselIds) !== JSON.stringify(postCarouselIds) ||
      formVideo !== postVideo ||
      formImage !== postImage
    );
  }, [formData.carouselAssets, formData.imageUrl, formData.videoUrl, post]);

  const persistMediaChanges = useCallback(async () => {
    if (!id || !mediaChanged) return;
    const assetIds = formData.carouselAssets.map((a) => a.id).filter(Boolean);
    const validAssetIds = assetIds.filter(
      (assetId) => typeof assetId === 'string' && !assetId.startsWith('http')
    );
    if (!validAssetIds.length) {
      toast.error('Media is missing asset IDs. Please re-select it from the Assets library.');
      throw new Error('Missing asset IDs for media update');
    }

    try {
      await contentApi.updateMedia(id, validAssetIds);
      await queryClient.invalidateQueries({ queryKey: ['post', id] });
    } catch (error) {
      console.error('Failed to update post media', error);
      toast.error('Failed to update post media. Please try again.');
      throw error;
    }
  }, [formData.carouselAssets, id, mediaChanged, queryClient]);

  const handleSaveChanges = async () => {
    if (!id || !hasChanges) return;

    if (!validation.ok) {
      toast.error(validationError || 'Please fix validation errors before saving');
      return;
    }

    try {
      await persistMediaChanges();
    } catch {
      return;
    }

    const hadScheduled = Boolean(post?.scheduledAt);
    const hasScheduledInput = Boolean(formData.scheduledAt);

    // Respect scheduling blockers (plan limits, validation, paused campaigns) when
    // turning a non-scheduled post into a scheduled one.
    if (!hadScheduled && hasScheduledInput && scheduleBlocker) {
      toast.error(scheduleBlocker);
      return;
    }

    let scheduledAtPayload: string | null | undefined;
    if (hadScheduled && !hasScheduledInput) {
      scheduledAtPayload = null;
    } else if (hasScheduledInput) {
      const utcDate = toUTCFromInput(formData.scheduledAt, brandTimezone);
      if (utcDate.getTime() <= Date.now()) {
        toast.error('Scheduled time must be in the future');
        return;
      }
      scheduledAtPayload = utcDate.toISOString();
    } else {
      scheduledAtPayload = undefined;
    }

    const payload: {
      contentId: string;
      caption?: string;
      scheduledAt?: string | null;
      campaignId?: string | null;
      firstComment?: string;
      mediaType?: InstagramMediaType;
      contentType?: InstagramContentType;
      videoUrl?: string;
      shareToFeed?: boolean;
    } = {
      contentId: id,
      caption: formData.contentType === 'story' ? '' : (formData.caption || '').trim(),
      campaignId: selectedCampaign || null,
      firstComment: formData.firstComment?.trim() || undefined,
    };

    if (scheduledAtPayload !== undefined) {
      payload.scheduledAt = scheduledAtPayload;
    }

    payload.mediaType = finalMediaType;
    payload.contentType = formData.contentType;

    if (finalMediaType === 'video') {
      payload.videoUrl = formData.videoUrl || undefined;
    }

    if (formData.contentType === 'reel') {
      payload.shareToFeed = formData.shareToFeed;
    }

    mutateContent(payload);
  };

  // Campaign selection state
  const [selectedCampaign, setSelectedCampaign] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
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
        if (mounted) setCampaigns((res.campaigns || []) as Campaign[]);
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

  const selectedCampaignData = useMemo(
    () => campaigns.find((c) => c.id === selectedCampaign) || null,
    [campaigns, selectedCampaign]
  );
  const selectedCampaignPaused = selectedCampaignData?.status === 'paused';

  const scheduleBlocker = getScheduleBlockerMessage({
    atCapacity,
    limitMessage,
    validationOk: validation.ok,
    validationError,
    hasScheduleTime,
    pausedCampaign: Boolean(selectedCampaignPaused),
  });
  const createScheduleDisabled = isCreatingPost || Boolean(scheduleBlocker);

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
    layout === 'sidebar' ? 'flex-1 px-4 pt-3 pb-32' : 'flex-1 overflow-y-auto px-4 py-4';

  // Allow mixed media for all non-reel content; reels must remain video-only.
  const allowMixedMedia = formData.contentType !== 'reel';
  const isVideoMedia = finalMediaType === 'video';

  const primaryEditCtaLabel = useMemo(() => {
    if (disabled) return 'Save Changes';
    const hadScheduled = Boolean(post?.scheduledAt);
    const hasScheduledInput = Boolean(formData.scheduledAt);

    if (!hadScheduled && hasScheduledInput) {
      // Turning a draft/failed post into a scheduled post
      return 'Save & Schedule';
    }
    if (hadScheduled && !hasScheduledInput) {
      // Removing the schedule time
      return 'Save as Draft';
    }
    if (hadScheduled && hasScheduledInput) {
      // Staying scheduled, possibly with a new time
      return 'Save & Update Schedule';
    }
    // Pure content changes on an unscheduled post
    return 'Save Changes';
  }, [disabled, post?.scheduledAt, formData.scheduledAt]);

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
                            onChange={(url, meta) =>
                              setFormData((s) => ({
                                ...s,
                                videoUrl: url,
                                carouselAssets: url
                                  ? [
                                      {
                                        id: meta?.assetId || url,
                                        url,
                                        type: 'video',
                                      },
                                    ]
                                  : [],
                                mediaType: url ? 'video' : s.mediaType,
                              }))
                            }
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

                    {/* First Comment (Optional) */}
                    <Collapsible
                      open={firstCommentOpen}
                      onOpenChange={setFirstCommentOpen}
                      className="space-y-2"
                    >
                      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm transition-colors">
                        <ChevronDown
                          className={cn(
                            'h-4 w-4 transition-transform duration-200',
                            firstCommentOpen && 'rotate-180'
                          )}
                        />
                        Add First Comment (Optional)
                      </CollapsibleTrigger>
                      <CollapsibleContent className="space-y-2 pt-2">
                        <Label htmlFor="firstComment" className="text-sm font-medium">
                          First Comment
                        </Label>
                        <Textarea
                          id="firstComment"
                          placeholder="Add hashtags, links, or CTAs..."
                          value={formData.firstComment || ''}
                          onChange={(e) =>
                            setFormData((s) => ({ ...s, firstComment: e.target.value }))
                          }
                          rows={4}
                          maxLength={2200}
                          className="resize-none"
                        />
                        <div className="text-muted-foreground flex justify-between text-xs">
                          <span className="italic">
                            Posts automatically when your content goes live
                          </span>
                          <span>{(formData.firstComment || '').length}/2200 characters</span>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </>
                )}

                {/* Campaign Selection */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Megaphone className="h-4 w-4" />
                    Campaign
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
                            {campaign.status === 'paused' ? ' (paused)' : ''}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  {selectedCampaignPaused && (
                    <p className="text-muted-foreground text-xs">
                      This campaign is paused. You can still save this post as a draft, but you
                      can&apos;t schedule it until the campaign is resumed.
                    </p>
                  )}
                </div>

                {/* Action Footer: scheduler + schedule actions */}
                {layout === 'page' && (
                  <div className="space-y-3 pt-4">
                    {atCapacity && (
                      <div className="bg-muted border-border text-foreground flex items-start gap-2 rounded-md border p-3 text-xs">
                        <AlertTriangle className="text-destructive mt-0.5 h-4 w-4 flex-shrink-0" />
                        <div className="space-y-1">
                          <p className="font-medium">
                            You&apos;ve reached your plan&apos;s scheduling limit.
                          </p>
                          <p className="text-muted-foreground">
                            You can still save drafts, but new scheduled posts will fail until you
                            free up slots or upgrade your plan.
                          </p>
                          <button
                            type="button"
                            onClick={() => (window.location.href = '/limits')}
                            className="text-xs font-medium underline underline-offset-2"
                          >
                            View scheduling limits
                          </button>
                        </div>
                      </div>
                    )}
                    <Separator />
                    <TooltipProvider>
                      <div className="border-border bg-card flex flex-col gap-3 rounded-md border px-3 py-2">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex flex-1 items-center gap-2">
                            <Clock className="text-muted-foreground h-4 w-4" />
                            <Input
                              type="datetime-local"
                              value={formData.scheduledAt}
                              onChange={(e) =>
                                setFormData((s) => ({ ...s, scheduledAt: e.target.value }))
                              }
                              min={minScheduleInput}
                              className="h-9 max-w-[220px]"
                            />
                            {brandTimezone && (
                              <span className="text-muted-foreground text-xs">
                                ({brandTimezone})
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-end">
                            <ButtonGroup>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    onClick={() => createPost('schedule')}
                                    disabled={createScheduleDisabled}
                                    aria-disabled={createScheduleDisabled}
                                    className={cn(createScheduleDisabled && 'cursor-not-allowed')}
                                  >
                                    {isCreatingPost ? (
                                      <>
                                        <Clock className="mr-2 h-4 w-4 animate-pulse" />
                                        Creating...
                                      </>
                                    ) : (
                                      <>
                                        <Clock className="mr-2 h-4 w-4" />
                                        Schedule
                                      </>
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                {scheduleBlocker && (
                                  <TooltipContent>
                                    <p className="text-sm">{scheduleBlocker}</p>
                                  </TooltipContent>
                                )}
                              </Tooltip>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="default"
                                    className="!px-2"
                                    aria-label="More scheduling options"
                                  >
                                    <ChevronDown className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-48">
                                  <DropdownMenuItem
                                    onClick={() => {
                                      if (isCreatingPost || !validation.ok) return;
                                      createPost('draft');
                                    }}
                                    disabled={isCreatingPost || !validation.ok}
                                  >
                                    <Save className="mr-2 h-4 w-4" />
                                    Save draft
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </ButtonGroup>
                          </div>
                        </div>
                      </div>
                    </TooltipProvider>
                  </div>
                )}
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

                {/* First Comment (Optional) */}
                <Collapsible
                  open={firstCommentOpen}
                  onOpenChange={setFirstCommentOpen}
                  className="space-y-2"
                >
                  <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm transition-colors">
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 transition-transform duration-200',
                        firstCommentOpen && 'rotate-180'
                      )}
                    />
                    Add First Comment (Optional)
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-2 pt-2">
                    <Label htmlFor="firstComment-edit" className="text-sm font-medium">
                      First Comment
                    </Label>
                    <Textarea
                      id="firstComment-edit"
                      placeholder="Add hashtags, links, or CTAs..."
                      value={formData.firstComment || ''}
                      onChange={(e) => setFormData((s) => ({ ...s, firstComment: e.target.value }))}
                      rows={4}
                      maxLength={2200}
                      className="resize-none"
                      disabled={disabled}
                    />
                    <div className="text-muted-foreground flex justify-between text-xs">
                      <span className="italic">
                        Posts automatically when your content goes live
                      </span>
                      <span>{(formData.firstComment || '').length}/2200 characters</span>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </>
            )}

            {/* Campaign Selection */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Megaphone className="h-4 w-4" />
                Campaign
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
                        {campaign.status === 'paused' ? ' (paused)' : ''}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {selectedCampaignPaused && (
                <p className="text-muted-foreground text-xs">
                  This campaign is paused. You can still save this post as a draft, but you
                  can&apos;t schedule it until the campaign is resumed.
                </p>
              )}
            </div>

            {/* Action Buttons (page layout only; sidebar uses sticky footer) */}
            {layout === 'page' && !disabled && (
              <div className="space-y-3 pt-4">
                <Separator />
                <TooltipProvider>
                  <div className="border-border bg-card flex flex-col gap-3 rounded-md border px-3 py-2">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-1 items-center gap-2">
                        <Clock className="text-muted-foreground h-4 w-4" />
                        <Input
                          type="datetime-local"
                          value={formData.scheduledAt}
                          onChange={(e) =>
                            setFormData((s) => ({ ...s, scheduledAt: e.target.value }))
                          }
                          min={minScheduleInput}
                          className="h-9 max-w-[220px]"
                        />
                        {brandTimezone && (
                          <span className="text-muted-foreground text-xs">({brandTimezone})</span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {isScheduled && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="outline" disabled={isUnscheduling}>
                                <Clock className="mr-2 h-4 w-4" />
                                Unschedule to Draft
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Unschedule this post?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  We’ll cancel the scheduled publish time and move this post back to
                                  Drafts. It will no longer publish automatically.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel disabled={isUnscheduling}>
                                  Cancel
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => id && unschedulePost(id)}
                                  disabled={isUnscheduling}
                                >
                                  Unschedule and move to Drafts
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
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
                              {primaryEditCtaLabel}
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </TooltipProvider>
              </div>
            )}
          </div>
        )}
      </div>
      {/* Sticky footer for sidebar layout: schedule time + actions */}
      {layout === 'sidebar' && (
        <>
          {isCreating && selectedBrand && (
            <div className="border-border bg-card sticky bottom-0 z-20 border-t px-4 py-3">
              <div className="space-y-3">
                {atCapacity && (
                  <div className="bg-muted border-border text-foreground flex items-start gap-2 rounded-md border p-3 text-xs">
                    <AlertTriangle className="text-destructive mt-0.5 h-4 w-4 flex-shrink-0" />
                    <div className="space-y-1">
                      <p className="font-medium">
                        You&apos;ve reached your plan&apos;s scheduling limit.
                      </p>
                      <p className="text-muted-foreground">
                        You can still save drafts, but new scheduled posts will fail until you free
                        up slots or upgrade your plan.
                      </p>
                      <button
                        type="button"
                        onClick={() => (window.location.href = '/limits')}
                        className="text-xs font-medium underline underline-offset-2"
                      >
                        View scheduling limits
                      </button>
                    </div>
                  </div>
                )}
                <TooltipProvider>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-1 items-center gap-2">
                      <Clock className="text-muted-foreground h-4 w-4" />
                      <Input
                        type="datetime-local"
                        value={formData.scheduledAt}
                        onChange={(e) =>
                          setFormData((s) => ({ ...s, scheduledAt: e.target.value }))
                        }
                        min={minScheduleInput}
                        className="h-9 max-w-[220px]"
                      />
                      {brandTimezone && (
                        <span className="text-muted-foreground text-xs">({brandTimezone})</span>
                      )}
                    </div>
                    <div className="flex items-center justify-end">
                      <ButtonGroup>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              onClick={() => createPost('schedule')}
                              disabled={createScheduleDisabled}
                              aria-disabled={createScheduleDisabled}
                              className={cn(createScheduleDisabled && 'cursor-not-allowed')}
                            >
                              {isCreatingPost ? (
                                <>
                                  <Clock className="mr-2 h-4 w-4 animate-pulse" />
                                  Creating...
                                </>
                              ) : (
                                <>
                                  <Clock className="mr-2 h-4 w-4" />
                                  Schedule
                                </>
                              )}
                            </Button>
                          </TooltipTrigger>
                          {scheduleBlocker && (
                            <TooltipContent>
                              <p className="text-sm">{scheduleBlocker}</p>
                            </TooltipContent>
                          )}
                        </Tooltip>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="default"
                              className="!px-2"
                              aria-label="More scheduling options"
                            >
                              <ChevronDown className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem
                              onClick={() => {
                                if (isCreatingPost || !validation.ok) return;
                                createPost('draft');
                              }}
                              disabled={isCreatingPost || !validation.ok}
                            >
                              <Save className="mr-2 h-4 w-4" />
                              Save draft
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </ButtonGroup>
                    </div>
                  </div>
                </TooltipProvider>
              </div>
            </div>
          )}
          {!isCreating && !isLoading && post && !disabled && (
            <div className="border-border bg-card sticky bottom-0 z-20 border-t px-4 py-3">
              <div className="space-y-3">
                <TooltipProvider>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-1 items-center gap-2">
                      <Clock className="text-muted-foreground h-4 w-4" />
                      <Input
                        type="datetime-local"
                        value={formData.scheduledAt}
                        onChange={(e) =>
                          setFormData((s) => ({ ...s, scheduledAt: e.target.value }))
                        }
                        min={minScheduleInput}
                        className="h-9 max-w-[220px]"
                      />
                      {brandTimezone && (
                        <span className="text-muted-foreground text-xs">({brandTimezone})</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {isScheduled && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" disabled={isUnscheduling}>
                              <Clock className="mr-2 h-4 w-4" />
                              Unschedule to Draft
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Unschedule this post?</AlertDialogTitle>
                              <AlertDialogDescription>
                                We’ll cancel the scheduled publish time and move this post back to
                                Drafts. It will no longer publish automatically.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel disabled={isUnscheduling}>
                                Cancel
                              </AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => id && unschedulePost(id)}
                                disabled={isUnscheduling}
                              >
                                Unschedule and move to Drafts
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
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
                            {primaryEditCtaLabel}
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </TooltipProvider>
              </div>
            </div>
          )}
        </>
      )}
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
                  carouselAssets: [
                    {
                      id: firstVideo.id || firstVideo.url,
                      url: firstVideo.url,
                      type: 'video',
                    },
                  ],
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
