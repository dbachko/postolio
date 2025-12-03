import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, memo, useEffect, useRef } from 'react';
import { content as contentApi, analyticsV2 } from '../lib/api';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import {
  Calendar,
  Clock,
  Heart,
  MessageCircle,
  Share2,
  BarChart3,
  Edit,
  Instagram,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  X,
  ExternalLink,
} from 'lucide-react';
import { getPlatformConfig, type Platform } from '@/lib/platform-config';
import { format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { useTimezone } from '../contexts/TimezoneContext';
import { formatInUserTimezone, toUTCFromInput, getUserTimezone } from '../lib/timezone';
import { toast } from 'sonner';
import { PostStatusBadge } from '../components/PostStatusBadge';

// Import our new reusable components
import { PostCaptionEditor } from '../components/PostCaptionEditor';
import { PostScheduler } from '../components/PostScheduler';
import { PostStatusCard } from '../components/PostStatusCard';
import { PostSaveIndicator, type SaveStatus } from '../components/PostSaveIndicator';
import { PostLearningFeedback } from '../components/PostLearningFeedback';
import { ImageUploader } from '../components/ImageUploader';
import { getPostImageOrPlaceholder } from '@/lib/placeholders';
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

interface PostDetailData {
  id: string;
  caption: string;
  imageUrl?: string;
  videoUrl?: string;
  contentType?: string;
  mediaType?: string;
  status: string;
  brandId: string;
  brand: {
    id: string;
    name: string;
  };
  // Normalize nullable backend fields: represent absence as undefined
  scheduledAt?: string;
  postedAt?: string;
  analytics?: {
    impressions?: number;
    reach?: number;
    engagement?: number;
  };
  generationParams?: {
    theme?: string;
    style?: string;
    scheduleId?: string;
    processing?: {
      active: boolean;
      operation: 'scheduling';
      startedAt: string;
      operationId?: string;
    };
  };
  schedulingError?: string | null;
  campaign?: {
    id: string;
    name: string;
    status: string;
  };
  // Optional: backend-provided convenience field for external link
  instagramPermalink?: string;
  createdAt: string;
  updatedAt: string;
}

interface PostInsights {
  metrics: {
    impressions: number;
    reach: number;
    engagement: number;
    saves: number;
    shares: number;
    comments_count: number;
    likes_count: number;
  };
  lastUpdated: string;
}

interface FormData {
  caption: string;
  imageUrl: string;
  scheduledAt: string;
}

const buildFormStateFromPost = (post: PostDetailData, timezone: string): FormData => {
  // CRITICAL: Always ensure we have a valid timezone for conversion
  const effectiveTimezone = timezone || getUserTimezone();

  return {
    caption: post.caption || '',
    imageUrl: post.imageUrl || '',
    scheduledAt: post.scheduledAt
      ? formatInTimeZone(new Date(post.scheduledAt), effectiveTimezone, "yyyy-MM-dd'T'HH:mm")
      : '',
  };
};

// Memoized metrics component to prevent unnecessary re-renders
const MetricsGrid = memo(({ insights }: { insights: PostInsights }) => (
  <div className="grid grid-cols-2 gap-3 md:gap-4">
    <div className="bg-muted rounded-lg p-3 md:p-4">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs md:text-sm">Likes</span>
        <Heart className="h-3 w-3 md:h-4 md:w-4" />
      </div>
      <p className="mt-1 text-lg font-bold md:text-2xl">
        {insights.metrics.likes_count.toLocaleString()}
      </p>
    </div>

    <div className="bg-muted rounded-lg p-3 md:p-4">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs md:text-sm">Comments</span>
        <MessageCircle className="h-3 w-3 md:h-4 md:w-4" />
      </div>
      <p className="mt-1 text-lg font-bold md:text-2xl">
        {insights.metrics.comments_count.toLocaleString()}
      </p>
    </div>

    <div className="bg-muted rounded-lg p-3 md:p-4">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs md:text-sm">Reach</span>
        <BarChart3 className="h-3 w-3 md:h-4 md:w-4" />
      </div>
      <p className="mt-1 text-lg font-bold md:text-2xl">
        {insights.metrics.reach.toLocaleString()}
      </p>
    </div>

    <div className="bg-muted rounded-lg p-3 md:p-4">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs md:text-sm">Shares</span>
        <Share2 className="h-3 w-3 md:h-4 md:w-4" />
      </div>
      <p className="mt-1 text-lg font-bold md:text-2xl">
        {insights.metrics.shares.toLocaleString()}
      </p>
    </div>
  </div>
));

export default function PostDetail() {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const editingInitializedRef = useRef(false);
  const [formData, setFormData] = useState<FormData>({
    caption: '',
    imageUrl: '',
    scheduledAt: '',
  });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const objectUrlRef = useRef<string | null>(null);
  const formInitializedRef = useRef(false);
  const [learningFeedback, setLearningFeedback] = useState<{
    isVisible: boolean;
    message: string;
    appliedToFuturePosts?: number;
  }>({ isVisible: false, message: '' });

  // Enable edit mode from query param (?edit=1) on initial mount
  useEffect(() => {
    const qs = new URLSearchParams(location.search);
    if (qs.get('edit') === '1') {
      setIsEditing(true);
    }
    // only run on first render for this post
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Status color handled by getContentDisplayStatus

  const { timezone, getBrandTimezone } = useTimezone();
  const [brandTimezone, setBrandTimezone] = useState<string>(timezone);

  // Fetch post details with auto-refresh
  const {
    data: post,
    isLoading: postLoading,
    isFetching: postFetching,
  } = useQuery<PostDetailData>({
    queryKey: ['post', postId],
    // Adapt backend response (which may contain nulls) into PostDetailData shape with undefined instead of null
    queryFn: async (): Promise<PostDetailData> => {
      const response = await contentApi.getPostDetail(postId!);
      const raw = response.data as any;
      return {
        ...raw,
        videoUrl: raw.videoUrl || undefined,
        contentType: raw.contentType || undefined,
        mediaType: raw.mediaType || undefined,
        brandId: raw.brand?.id,
        brand: raw.brand || { id: '', name: '' },
        scheduledAt: raw.scheduledAt || undefined,
        postedAt: raw.postedAt || undefined,
        imageUrl: raw.imageUrl || undefined,
        instagramPermalink: raw.instagramPermalink || undefined,
        generationParams: raw.generationParams ? { ...raw.generationParams } : undefined,
        schedulingError: raw.schedulingError || undefined,
        campaign: raw.campaign ? { ...raw.campaign } : undefined,
      };
    },
    enabled: !!postId,
    refetchInterval: 30000,
    staleTime: 10000,
  });

  // Resolve brand timezone when post loads
  useEffect(() => {
    let mounted = true;
    (async () => {
      const brandId = post?.brand?.id;
      if (!brandId) return;

      try {
        const tz = await getBrandTimezone(brandId);
        if (mounted && tz) setBrandTimezone(tz);
      } catch (error) {
        console.error('[PostDetail] Failed to fetch brand timezone:', error);
        if (mounted) setBrandTimezone(timezone);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [post?.brand?.id, getBrandTimezone, timezone]);

  // Fetch v2 publications then latest metrics
  const publicationsQuery = useQuery<{ success: boolean; data: Array<any> }>({
    queryKey: ['v2-publications', postId],
    queryFn: async () => analyticsV2.getPublicationsByContent(postId!),
    enabled: !!postId && post?.status === 'published',
    staleTime: 30000,
  });

  const selectedPublicationId = (() => {
    const pubs = publicationsQuery.data?.data || [];
    if (!pubs.length) return undefined;
    // Prefer Instagram for backward compatibility, but any platform works
    const preferred = pubs.find((p: any) => p.platform === 'instagram');
    return (preferred || pubs[0])?.id as string | undefined;
  })();

  const latestQuery = useQuery<{ success: boolean; data: any } | undefined>({
    queryKey: ['v2-latest', selectedPublicationId],
    queryFn: async () =>
      selectedPublicationId
        ? await analyticsV2.getPublicationLatest(selectedPublicationId)
        : undefined,
    enabled: !!selectedPublicationId,
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const insights: PostInsights | undefined = (() => {
    const latest = latestQuery.data?.data;
    if (!latest) return undefined;
    return {
      metrics: {
        impressions: Number(latest.impressions || 0),
        reach: Number(latest.reach || 0),
        engagement: Number(latest.engagement || 0),
        saves: Number(latest.saves || 0),
        shares: Number(latest.shares || 0),
        comments_count: Number(latest.comments || 0),
        likes_count: Number(latest.likes || 0),
      },
      lastUpdated: latest.lastUpdated || new Date().toISOString(),
    };
  })();

  // Default to editing mode when the post loads, unless it's published (then keep disabled)
  useEffect(() => {
    if (editingInitializedRef.current) return;
    if (!post) return;
    editingInitializedRef.current = true;
    if (post.status !== 'published') {
      setIsEditing(true);
    }
  }, [post]);

  // Fetch comments
  const { data: commentsData } = useQuery<{
    comments: { username: string; text: string }[];
  }>({
    queryKey: ['post-comments', postId],
    queryFn: async () => (await contentApi.getPostComments(postId!)).data,
    enabled: !!postId && post?.status === 'published',
    staleTime: 60000,
  });

  // Initialize form data when post loads or editing starts
  useEffect(() => {
    if (post && isEditing) {
      setFormData(buildFormStateFromPost(post, brandTimezone || timezone));
      setHasChanges(false);
      formInitializedRef.current = true;
    }
  }, [post, isEditing, brandTimezone, timezone]);

  // If timezone changes after form initialized, realign scheduled time display to that zone
  useEffect(() => {
    if (post && isEditing && formInitializedRef.current) {
      setFormData((prev) => ({
        ...prev,
        scheduledAt: post.scheduledAt
          ? formatInTimeZone(
              new Date(post.scheduledAt),
              brandTimezone || timezone,
              "yyyy-MM-dd'T'HH:mm"
            )
          : '',
      }));
    }
  }, [brandTimezone, timezone, post, isEditing]);

  // Clean up object URL on unmount
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  // Update post mutation with learning feedback
  const { mutate: mutateContent, isPending: isSaving } = useMutation({
    mutationFn: async (data: {
      contentId: string;
      caption?: string;
      hashtags?: string[];
      imageUrl?: string;
      scheduledAt?: string | null;
    }) => {
      if (!data.caption || data.caption.trim().length === 0) {
        throw new Error('Cannot update content with empty caption');
      }
      return contentApi.updateContent(data);
    },
    onMutate: () => {
      setSaveStatus('saving');
    },
    onSuccess: (response) => {
      setSaveStatus('saved');
      setLastSaved(new Date());

      // Show learning feedback if AI learned from edits
      if (response.learning?.learningActive) {
        setLearningFeedback({
          isVisible: true,
          message: response.learning.message || 'AI is learning from your edits...',
          appliedToFuturePosts: response.learning.appliedToFuturePosts,
        });
      }

      // Update the post in cache
      queryClient.setQueryData(['post', postId], (oldData: PostDetailData | undefined) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          ...response.content,
          updatedAt: new Date().toISOString(),
        };
      });

      setTimeout(() => {
        setSaveStatus('idle');
      }, 2000);
    },
    onError: (error) => {
      setSaveStatus('error');
      console.error('Failed to update content:', error);
      toast.error('Failed to save changes');

      setTimeout(() => {
        setSaveStatus('idle');
      }, 3000);
    },
  });

  useEffect(() => {
    if (!post || !formInitializedRef.current) {
      return;
    }

    const trimmedCaption = (formData.caption || '').trim();
    const originalCaption = (post.caption || '').trim();

    const scheduledValue = formData.scheduledAt || '';
    const originalScheduled = post.scheduledAt
      ? formatInTimeZone(
          new Date(post.scheduledAt),
          brandTimezone || timezone,
          "yyyy-MM-dd'T'HH:mm"
        )
      : '';

    const formImage = formData.imageUrl || '';
    const postImage = post.imageUrl || '';

    const formChanged =
      trimmedCaption !== originalCaption ||
      formImage !== postImage ||
      scheduledValue !== originalScheduled;

    setHasChanges(formChanged);
  }, [formData, post, brandTimezone, timezone]);

  const handleCaptionChange = (value: string) => {
    setFormData((prev) => ({ ...prev, caption: value }));
  };

  const handleScheduledAtChange = (value: string) => {
    setFormData((prev) => ({ ...prev, scheduledAt: value }));
  };

  const handleImageChange = async (fileOrUrl: string | File) => {
    if (typeof fileOrUrl === 'string') {
      // Direct URL update
      setFormData((prev) => ({ ...prev, imageUrl: fileOrUrl }));
    } else {
      // File upload
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
      const objectUrl = URL.createObjectURL(fileOrUrl);
      objectUrlRef.current = objectUrl;
      setFormData((prev) => ({ ...prev, imageUrl: objectUrl }));

      // Upload to server
      if (postId) {
        setSaveStatus('saving');
        try {
          if (!post?.brandId) {
            throw new Error('Missing brand information for upload');
          }
          const response = await contentApi.uploadContentImage(postId, post.brandId, fileOrUrl);
          if (response.success && response.content) {
            const newImageUrl = response.content.imageUrl || objectUrl;
            setFormData((prev) => ({
              ...prev,
              imageUrl: newImageUrl,
            }));
            setSaveStatus('saved');
            setLastSaved(new Date());

            // Clean up object URL
            if (objectUrlRef.current) {
              URL.revokeObjectURL(objectUrlRef.current);
              objectUrlRef.current = null;
            }

            // Update cache
            queryClient.setQueryData(['post', postId], (oldData: PostDetailData | undefined) => {
              if (!oldData) return oldData;
              return {
                ...oldData,
                imageUrl: response.content.imageUrl,
              };
            });

            setTimeout(() => {
              setSaveStatus('idle');
            }, 2000);
          }
        } catch (error) {
          console.error('Failed to upload image:', error);
          setSaveStatus('error');
          toast.error('Failed to upload image');
          // Revert to previous image
          setFormData((prev) => ({
            ...prev,
            imageUrl: post?.imageUrl || '',
          }));
          setTimeout(() => {
            setSaveStatus('idle');
          }, 3000);
        }
      }
    }
  };

  const handleSaveChanges = () => {
    if (!post || !postId || !hasChanges) {
      return;
    }

    const trimmedCaption = (formData.caption || '').trim();
    if (trimmedCaption.length === 0) {
      toast.error('Caption cannot be empty');
      return;
    }

    const hadScheduled = Boolean(post.scheduledAt);
    const hasScheduledInput = Boolean(formData.scheduledAt);

    let scheduledAtPayload: string | null | undefined;
    if (hadScheduled && !hasScheduledInput) {
      scheduledAtPayload = null;
    } else if (hasScheduledInput) {
      // Interpret datetime-local input as being in brand timezone
      scheduledAtPayload = toUTCFromInput(formData.scheduledAt, brandTimezone).toISOString();
    } else {
      scheduledAtPayload = undefined;
    }

    const payload: {
      contentId: string;
      caption: string;
      imageUrl?: string;
      scheduledAt?: string | null;
    } = {
      contentId: postId,
      caption: trimmedCaption,
      imageUrl: formData.imageUrl || undefined,
    };

    if (scheduledAtPayload !== undefined) {
      payload.scheduledAt = scheduledAtPayload;
    }

    mutateContent(payload);
  };

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setSaveStatus('idle');
    setLastSaved(null);
    setLearningFeedback({ isVisible: false, message: '' });
    if (post) {
      setFormData(buildFormStateFromPost(post, brandTimezone || timezone));
      setHasChanges(false);
      formInitializedRef.current = true;
    }

    // Clean up object URL
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  const handleDismissLearning = () => {
    setLearningFeedback({ isVisible: false, message: '' });
  };

  // Use brand timezone for quick actions as well

  // Quick action mutations
  const schedulePostMutation = useMutation({
    mutationFn: async (scheduledAt: string) => {
      let utcDate: Date | null = null;
      if (scheduledAt) {
        if (scheduledAt.endsWith('Z')) {
          utcDate = new Date(scheduledAt);
        } else {
          // Normalize space-separated input to ISO-like then convert from brand timezone to UTC
          const normalized = scheduledAt.includes('T')
            ? scheduledAt
            : scheduledAt.replace(' ', 'T');
          utcDate = toUTCFromInput(normalized, brandTimezone);
        }
      }

      if (!utcDate) throw new Error('Scheduled time required');
      if (utcDate.getTime() <= Date.now()) {
        throw new Error('Scheduled time must be in the future');
      }

      return contentApi.schedulePost(postId!, utcDate.toISOString());
    },
    onSuccess: (resp) => {
      toast.success('Scheduling started', {
        description: 'We will update the status once the scheduler confirms it.',
      });
      // Optimistically mark as processing until scheduler confirms status
      queryClient.setQueryData(['post', postId], (oldData: PostDetailData | undefined) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          generationParams: {
            ...(oldData.generationParams || {}),
            processing: {
              active: true,
              operation: 'scheduling',
              startedAt: new Date().toISOString(),
              operationId: (resp as any)?.content?.generationParams?.processing?.operationId,
            },
          },
        };
      });
    },
    onError: (error: any) => {
      const message =
        (error?.data?.errors && Array.isArray(error.data.errors) && error.data.errors[0]) ||
        error?.data?.error ||
        error?.message ||
        'Failed to schedule post';
      toast.error(message);
    },
  });

  const publishNowMutation = useMutation({
    mutationFn: async () => {
      return contentApi.publishPost(postId!);
    },
    onSuccess: () => {
      toast.success('Post published successfully');
      queryClient.invalidateQueries({ queryKey: ['post', postId] });
    },
    onError: () => {
      toast.error('Failed to publish post');
    },
  });

  const deletePostMutation = useMutation({
    mutationFn: async () => {
      return contentApi.deletePost(postId!);
    },
    onSuccess: () => {
      toast.success('Post deleted successfully');
      navigate(-1);
    },
    onError: () => {
      toast.error('Failed to delete post');
    },
  });

  const unschedulePostMutation = useMutation({
    mutationFn: async () => {
      return contentApi.updateContent({
        contentId: postId!,
        scheduledAt: null,
      });
    },
    onSuccess: (response) => {
      toast.success('Post unscheduled and moved to Drafts');
      queryClient.setQueryData(['post', postId], (oldData: PostDetailData | undefined) => {
        if (!oldData) return oldData;
        const nextContent = (response as any)?.content || {};
        return {
          ...oldData,
          ...nextContent,
          status: nextContent.status || 'draft',
          updatedAt: new Date().toISOString(),
        };
      });
      const brandId = (response as any)?.content?.brandId || post?.brandId;
      if (brandId) {
        queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
        queryClient.invalidateQueries({ queryKey: ['drafts', brandId] });
      }
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.error ||
        error?.message ||
        'Failed to unschedule post. Please try again.';
      toast.error(message);
    },
  });

  if (postLoading || !post) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="border-primary h-8 w-8 animate-spin rounded-full border-b-2"></div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl">
      {/* Header */}
      <div className="mb-4 md:mb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex-1">
            <div className="mb-2 flex items-center gap-4">
              <h1 className="text-xl font-bold sm:text-2xl md:text-3xl">Post Details</h1>
              {isEditing && (
                <PostSaveIndicator
                  status={saveStatus}
                  lastSaved={lastSaved}
                  showAILearningMessage={saveStatus === 'saved'}
                  idleHint="Click Save to apply your edits"
                />
              )}
            </div>
            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs sm:gap-4 sm:text-sm">
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                Created {format(new Date(post.createdAt), 'MMM d, yyyy')}
              </span>
              {post.campaign && (
                <Link
                  to={`/campaigns/${post.campaign.id}`}
                  className="flex items-center gap-1 hover:underline"
                  title={`View campaign: ${post.campaign.name}`}
                >
                  <span>Campaign:</span>
                  <span>{post.campaign.name}</span>
                </Link>
              )}
              {(postFetching || publicationsQuery.isFetching || latestQuery.isFetching) && (
                <span className="flex items-center gap-1">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  Updating...
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <PostStatusBadge
              status={post.status as any}
              generationParams={post.generationParams as any}
              schedulingError={post.schedulingError || null}
              scheduledAt={post.scheduledAt || undefined}
            />
            {(() => {
              const pubs = publicationsQuery.data?.data || [];
              if (!pubs.length) return null;

              // Show button for each published platform
              return pubs.map((pub: any) => {
                if (!pub.permalink) return null;
                const platformConfig = getPlatformConfig(pub.platform as Platform);

                return (
                  <Button
                    key={pub.id}
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(pub.permalink, '_blank')}
                    className="text-xs sm:text-sm"
                  >
                    {pub.platform === 'instagram' ? (
                      <Instagram className="mr-1 h-4 w-4 sm:mr-2" />
                    ) : (
                      <ExternalLink className="mr-1 h-4 w-4 sm:mr-2" />
                    )}
                    <span className="hidden sm:inline">View on</span> {platformConfig.displayName}
                  </Button>
                );
              });
            })()}
          </div>
        </div>
      </div>

      {/* Learning Feedback Banner */}
      <PostLearningFeedback
        isVisible={learningFeedback.isVisible}
        message={learningFeedback.message}
        appliedToFuturePosts={learningFeedback.appliedToFuturePosts}
        onDismiss={handleDismissLearning}
        className="mb-4"
      />

      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="order-2 space-y-4 md:space-y-6 lg:order-1 lg:col-span-2">
          {/* Post Content Card */}
          <Card className="p-4 md:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold md:text-xl">Content</h2>
              {!isEditing ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleEdit}
                  disabled={post.status === 'published'}
                  title={
                    post.status === 'published' ? 'Cannot edit published content' : 'Edit this post'
                  }
                >
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
                    <X className="mr-2 h-4 w-4" />
                    Cancel
                  </Button>
                  {post.status === 'scheduled' && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={unschedulePostMutation.isPending}
                        >
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
                          <AlertDialogCancel disabled={unschedulePostMutation.isPending}>
                            Cancel
                          </AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => unschedulePostMutation.mutate()}
                            disabled={unschedulePostMutation.isPending}
                          >
                            Unschedule and move to Drafts
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                  <Button size="sm" onClick={handleSaveChanges} disabled={!hasChanges || isSaving}>
                    Save Changes
                  </Button>
                </div>
              )}
            </div>

            {isEditing ? (
              <div className="space-y-6">
                {/* Image Upload */}
                <div className="space-y-2">
                  <Label>Post Image</Label>
                  <ImageUploader
                    className="w-full max-w-[260px]"
                    value={formData.imageUrl || undefined}
                    onChange={handleImageChange}
                    maxSizeInMB={10}
                    acceptedFormats={['image/jpeg', 'image/jpg', 'image/png', 'image/webp']}
                  />
                </div>

                {/* Caption Editor */}
                <PostCaptionEditor
                  value={formData.caption}
                  onChange={handleCaptionChange}
                  brandId={post.brandId}
                />

                {/* Scheduler */}
                <PostScheduler value={formData.scheduledAt} onChange={handleScheduledAtChange} />
              </div>
            ) : (
              <>
                {/* Media */}
                <div className="bg-muted mb-4 overflow-hidden rounded-lg">
                  {post.videoUrl ? (
                    <video
                      src={post.videoUrl}
                      className="h-auto max-h-[250px] w-full object-cover"
                      controls
                    />
                  ) : (
                    <img
                      src={getPostImageOrPlaceholder(post.imageUrl)}
                      alt="Post content"
                      className="h-auto max-h-[250px] w-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                </div>

                {/* Caption */}
                <div className="space-y-4">
                  <p className="text-foreground whitespace-pre-wrap">{post.caption}</p>
                </div>
              </>
            )}

            {/* Post Status Card */}
            {!isEditing && (
              <div className="mt-6">
                <PostStatusCard
                  status={post.status as 'draft' | 'scheduled' | 'published' | 'failed' | 'skipped'}
                  createdAt={post.createdAt}
                  processing={Boolean((post as any)?.generationParams?.processing?.active)}
                  errorMessage={post.schedulingError || null}
                />
              </div>
            )}
          </Card>

          {/* Analytics Tab */}
          {post.status === 'published' && (
            <Card className="p-4 md:p-6">
              <Tabs defaultValue="metrics" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="metrics">Metrics</TabsTrigger>
                  <TabsTrigger value="comments">Comments</TabsTrigger>
                </TabsList>

                <TabsContent value="metrics" className="mt-6">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-muted-foreground text-xs">
                      {insights
                        ? `Last updated: ${new Date(insights.lastUpdated).toLocaleString()}`
                        : 'No metrics yet'}
                    </div>
                    {selectedPublicationId && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          try {
                            await analyticsV2.refreshPublication(selectedPublicationId);
                            toast.success('Refresh enqueued');
                          } catch (e: any) {
                            const status = e?.status;
                            const next = e?.data?.nextRefreshAllowed;
                            if (status === 429) {
                              toast.error(
                                next
                                  ? `Refresh throttled. Try after ${new Date(next).toLocaleTimeString()}`
                                  : 'Refresh throttled. Try later.'
                              );
                            } else {
                              toast.error('Refresh throttled or failed');
                            }
                          }
                        }}
                      >
                        <RefreshCw className="mr-2 h-4 w-4" /> Refresh
                      </Button>
                    )}
                  </div>
                  {insights ? (
                    <MetricsGrid insights={insights} />
                  ) : (
                    <p className="text-muted-foreground py-8 text-center">
                      No metrics yet. If this was just published or synced, metrics may take up to
                      15 minutes to appear. Use Refresh to request an update.
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="comments" className="mt-6">
                  {commentsData?.comments && commentsData.comments.length > 0 ? (
                    <div className="max-h-[400px] space-y-4 overflow-y-auto">
                      {commentsData.comments.map(
                        (comment: { username: string; text: string }, index: number) => (
                          <div
                            key={index}
                            className="bg-muted flex items-start gap-3 rounded-lg p-3"
                          >
                            <div className="mt-0.5">
                              <Avatar name={comment.username} size="sm" />
                            </div>
                            <div className="flex-1">
                              <p className="text-sm font-medium">{comment.username}</p>
                              <p className="text-foreground mt-1 text-sm">{comment.text}</p>
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  ) : insights && insights.metrics.comments_count > 0 && selectedPublicationId ? (
                    <div className="text-muted-foreground flex flex-col items-center gap-3 py-8 text-center">
                      <p>
                        {insights.metrics.comments_count.toLocaleString()} comment
                        {insights.metrics.comments_count === 1 ? '' : 's'} on Instagram. They may
                        not be synced yet.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          try {
                            await analyticsV2.refreshPublication(selectedPublicationId);
                            toast.success('Comments refresh enqueued');
                          } catch {
                            toast.error('Unable to enqueue refresh');
                          }
                        }}
                      >
                        <RefreshCw className="mr-2 h-4 w-4" /> Refresh Comments
                      </Button>
                    </div>
                  ) : (
                    <p className="text-muted-foreground py-8 text-center">No comments yet</p>
                  )}
                </TabsContent>
              </Tabs>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="order-1 space-y-4 md:space-y-6 lg:order-2">
          {/* Post Info */}
          <Card className="p-4 md:p-6">
            <h3 className="mb-3 text-base font-semibold md:mb-4 md:text-lg">Information</h3>
            <div className="space-y-2 text-xs md:space-y-3 md:text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Brand</span>
                <span className="font-medium">{post.brand.name}</span>
              </div>

              {post.scheduledAt && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Scheduled</span>
                  <span className="font-medium">
                    {formatInUserTimezone(post.scheduledAt, 'MMM d, h:mm a', brandTimezone)}
                  </span>
                </div>
              )}

              {post.postedAt && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Published</span>
                  <span className="font-medium">
                    {formatInUserTimezone(post.postedAt, 'MMM d, h:mm a', brandTimezone)}
                  </span>
                </div>
              )}

              {post.generationParams && (
                <>
                  <hr className="my-3" />
                  {post.generationParams.theme && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Theme</span>
                      <span className="font-medium">{post.generationParams.theme}</span>
                    </div>
                  )}
                  {post.generationParams.style && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Style</span>
                      <span className="font-medium">{post.generationParams.style}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </Card>

          {/* Quick Actions */}
          <Card className="p-4 md:p-6">
            <h3 className="mb-3 text-base font-semibold md:mb-4 md:text-lg">Quick Actions</h3>
            <div className="space-y-2">
              {post.status === 'draft' && (
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => {
                    const scheduledAt = prompt('Schedule for (YYYY-MM-DD HH:MM):');
                    if (scheduledAt) {
                      schedulePostMutation.mutate(scheduledAt);
                    }
                  }}
                  disabled={schedulePostMutation.isPending}
                >
                  <Clock className="mr-2 h-4 w-4" />
                  Schedule Post
                </Button>
              )}

              {post.status === 'scheduled' && (
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => {
                    if (confirm('Publish this post now?')) {
                      publishNowMutation.mutate();
                    }
                  }}
                  disabled={publishNowMutation.isPending}
                >
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Publish Now
                </Button>
              )}

              <Button
                className="w-full"
                variant="destructive"
                onClick={() => {
                  if (confirm('Are you sure you want to delete this post?')) {
                    deletePostMutation.mutate();
                  }
                }}
                disabled={deletePostMutation.isPending}
              >
                <AlertCircle className="mr-2 h-4 w-4" />
                Delete Post
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
