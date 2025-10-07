import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo, memo, useEffect, useRef } from 'react';
import { apiClient } from '../lib/api';
import { useDebounce } from '../hooks/useDebounce';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Label } from '../components/ui/label';
import {
  Calendar,
  Clock,
  Heart,
  MessageCircle,
  Share2,
  BarChart3,
  Edit,
  ArrowLeft,
  Instagram,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  X,
} from 'lucide-react';
import { format } from 'date-fns';
import { useTimezone } from '../contexts/TimezoneContext';
import { formatInUserTimezone, convertLocalToUTC } from '../lib/timezone';
import { toast } from 'sonner';

// Import our new reusable components
import { PostCaptionEditor } from '../components/PostCaptionEditor';
import { PostHashtagEditor } from '../components/PostHashtagEditor';
import { PostScheduler } from '../components/PostScheduler';
import { PostStatusCard } from '../components/PostStatusCard';
import { PostSaveIndicator, type SaveStatus } from '../components/PostSaveIndicator';
import { PostLearningFeedback } from '../components/PostLearningFeedback';
import { ImageUploader } from '../components/ImageUploader';

interface PostDetailData {
  id: string;
  caption: string;
  hashtags: string[];
  imageUrl?: string;
  status: string;
  // Normalize nullable backend fields: represent absence as undefined
  scheduledAt?: string;
  postedAt?: string;
  instagramPostId?: string;
  instagramPermalink?: string;
  analytics?: {
    impressions?: number;
    reach?: number;
    engagement?: number;
  };
  generationParams?: {
    theme?: string;
    style?: string;
    scheduleId?: string;
  };
  brand: {
    id: string;
    name: string;
  };
  campaign?: {
    id: string;
    name: string;
    status: string;
  };
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
  hashtags: string[];
  imageUrl: string;
  scheduledAt: string;
}

// Memoized metrics component to prevent unnecessary re-renders
const MetricsGrid = memo(({ insights }: { insights: PostInsights }) => (
  <div className="grid grid-cols-2 gap-3 md:gap-4">
    <div className="rounded-lg bg-gray-50 p-3 md:p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-600 md:text-sm">Likes</span>
        <Heart className="h-3 w-3 text-red-500 md:h-4 md:w-4" />
      </div>
      <p className="mt-1 text-lg font-bold md:text-2xl">
        {insights.metrics.likes_count.toLocaleString()}
      </p>
    </div>

    <div className="rounded-lg bg-gray-50 p-3 md:p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-600 md:text-sm">Comments</span>
        <MessageCircle className="h-3 w-3 text-blue-500 md:h-4 md:w-4" />
      </div>
      <p className="mt-1 text-lg font-bold md:text-2xl">
        {insights.metrics.comments_count.toLocaleString()}
      </p>
    </div>

    <div className="rounded-lg bg-gray-50 p-3 md:p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-600 md:text-sm">Reach</span>
        <BarChart3 className="h-3 w-3 text-green-500 md:h-4 md:w-4" />
      </div>
      <p className="mt-1 text-lg font-bold md:text-2xl">
        {insights.metrics.reach.toLocaleString()}
      </p>
    </div>

    <div className="rounded-lg bg-gray-50 p-3 md:p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-600 md:text-sm">Shares</span>
        <Share2 className="h-3 w-3 text-purple-500 md:h-4 md:w-4" />
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
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    caption: '',
    hashtags: [],
    imageUrl: '',
    scheduledAt: '',
  });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [learningFeedback, setLearningFeedback] = useState<{
    isVisible: boolean;
    message: string;
    appliedToFuturePosts?: number;
  }>({ isVisible: false, message: '' });

  // Memoize status color calculation
  const getStatusColor = useMemo(() => {
    return (status: string) => {
      const colors: Record<string, string> = {
        draft: 'bg-gray-100 text-gray-700',
        scheduled: 'bg-blue-100 text-blue-700',
        published: 'bg-green-100 text-green-700',
        failed: 'bg-red-100 text-red-700',
      };
      return colors[status] || 'bg-gray-100 text-gray-700';
    };
  }, []);

  // Fetch post details with auto-refresh
  const {
    data: post,
    isLoading: postLoading,
    isFetching: postFetching,
  } = useQuery<PostDetailData>({
    queryKey: ['post', postId],
    // Adapt backend response (which may contain nulls) into PostDetailData shape with undefined instead of null
    queryFn: async (): Promise<PostDetailData> => {
      const response = await apiClient.getPostDetail(postId!);
      const raw = response.data as any;
      return {
        ...raw,
        scheduledAt: raw.scheduledAt || undefined,
        postedAt: raw.postedAt || undefined,
        instagramPostId: raw.instagramPostId || undefined,
        instagramPermalink: raw.instagramPermalink || undefined,
        imageUrl: raw.imageUrl || undefined,
        generationParams: raw.generationParams ? { ...raw.generationParams } : undefined,
        campaign: raw.campaign ? { ...raw.campaign } : undefined,
      };
    },
    enabled: !!postId,
    refetchInterval: 30000,
    staleTime: 10000,
  });

  // Fetch post insights
  const { data: insights, isFetching: insightsFetching } = useQuery<PostInsights>({
    queryKey: ['post-insights', postId],
    queryFn: async () => {
      const response = await apiClient.getPostInsights(postId!);
      return response.data;
    },
    enabled: !!postId && post?.status === 'published',
    refetchInterval: 60000,
    staleTime: 30000,
  });

  // Fetch comments
  const { data: commentsData } = useQuery<{
    comments: { username: string; text: string }[];
  }>({
    queryKey: ['post-comments', postId],
    queryFn: async () => (await apiClient.getPostComments(postId!)).data,
    enabled: !!postId && post?.status === 'published',
    staleTime: 60000,
  });

  // Initialize form data when post loads or editing starts
  useEffect(() => {
    if (post && isEditing) {
      setFormData({
        caption: post.caption || '',
        hashtags: post.hashtags || [],
        imageUrl: post.imageUrl || '',
        scheduledAt: post.scheduledAt
          ? format(new Date(post.scheduledAt), "yyyy-MM-dd'T'HH:mm")
          : '',
      });
    }
  }, [post, isEditing]);

  // Clean up object URL on unmount
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  // Debounced form data for auto-save
  const debouncedFormData = useDebounce(formData, 500);

  // Update post mutation with learning feedback
  const updateContentMutation = useMutation({
    mutationFn: async (data: {
      contentId: string;
      caption?: string;
      hashtags?: string[];
      imageUrl?: string;
      scheduledAt?: string;
    }) => {
      if (!data.caption || data.caption.trim().length === 0) {
        throw new Error('Cannot update content with empty caption');
      }
      return apiClient.updateContent(data);
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

  // Auto-save when debounced form data changes
  useEffect(() => {
    if (!post || !isEditing || !postId) return;

    // Don't auto-save if caption is empty
    if (!debouncedFormData.caption || debouncedFormData.caption.trim().length === 0) {
      return;
    }

    // Check if form data has changed from original
    const hasChanges =
      debouncedFormData.caption !== post.caption ||
      JSON.stringify(debouncedFormData.hashtags) !== JSON.stringify(post.hashtags) ||
      debouncedFormData.imageUrl !== (post.imageUrl || '') ||
      debouncedFormData.scheduledAt !==
        (post.scheduledAt ? format(new Date(post.scheduledAt), "yyyy-MM-dd'T'HH:mm") : '');

    if (hasChanges) {
      updateContentMutation.mutate({
        contentId: postId,
        caption: debouncedFormData.caption,
        hashtags: debouncedFormData.hashtags,
        imageUrl: debouncedFormData.imageUrl || undefined,
        scheduledAt: debouncedFormData.scheduledAt,
      });
    }
  }, [debouncedFormData, post, isEditing, postId, updateContentMutation]);

  const handleCaptionChange = (value: string) => {
    setFormData((prev) => ({ ...prev, caption: value }));
  };

  const handleHashtagsChange = (hashtags: string[]) => {
    setFormData((prev) => ({ ...prev, hashtags }));
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
          const response = await apiClient.uploadContentImage(postId, fileOrUrl);
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

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setSaveStatus('idle');
    setLastSaved(null);
    setLearningFeedback({ isVisible: false, message: '' });

    // Clean up object URL
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  const handleDismissLearning = () => {
    setLearningFeedback({ isVisible: false, message: '' });
  };

  const { timezone } = useTimezone();

  // Quick action mutations
  const schedulePostMutation = useMutation({
    mutationFn: async (scheduledAt: string) => {
      let payload = scheduledAt;
      if (scheduledAt && !scheduledAt.endsWith('Z')) {
        const local = new Date(scheduledAt);
        const utc = convertLocalToUTC(local, timezone);
        payload = utc.toISOString();
      }
      return apiClient.schedulePost(postId!, payload);
    },
    onSuccess: () => {
      toast.success('Post scheduled successfully');
      queryClient.invalidateQueries({ queryKey: ['post', postId] });
    },
    onError: () => {
      toast.error('Failed to schedule post');
    },
  });

  const publishNowMutation = useMutation({
    mutationFn: async () => {
      return apiClient.publishPost(postId!);
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
      return apiClient.deletePost(postId!);
    },
    onSuccess: () => {
      toast.success('Post deleted successfully');
      navigate(-1);
    },
    onError: () => {
      toast.error('Failed to delete post');
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
    <div className="container mx-auto max-w-7xl px-4 py-4 md:py-8">
      {/* Header */}
      <div className="mb-4 md:mb-6">
        <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4" size="sm">
          <ArrowLeft className="mr-1 h-4 w-4 md:mr-2" />
          <span className="hidden sm:inline">Back</span>
        </Button>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex-1">
            <div className="mb-2 flex items-center gap-4">
              <h1 className="text-xl font-bold sm:text-2xl md:text-3xl">Post Details</h1>
              {isEditing && (
                <PostSaveIndicator
                  status={saveStatus}
                  lastSaved={lastSaved}
                  showAILearningMessage={saveStatus === 'saved'}
                />
              )}
            </div>
            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs sm:gap-4 sm:text-sm">
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                Created {format(new Date(post.createdAt), 'MMM d, yyyy')}
              </span>
              {post.campaign && (
                <span className="flex items-center gap-1">Campaign: {post.campaign.name}</span>
              )}
              {(postFetching || insightsFetching) && (
                <span className="flex items-center gap-1 text-blue-600">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  Updating...
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge className={getStatusColor(post.status)}>{post.status}</Badge>
            {post.instagramPermalink && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(post.instagramPermalink, '_blank')}
                className="text-xs sm:text-sm"
              >
                <Instagram className="mr-1 h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">View on</span> Instagram
              </Button>
            )}
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
                <Button variant="outline" size="sm" onClick={handleEdit}>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
                  <X className="mr-2 h-4 w-4" />
                  Cancel
                </Button>
              )}
            </div>

            {isEditing ? (
              <div className="space-y-6">
                {/* Image Upload */}
                <div className="space-y-2">
                  <Label>Post Image</Label>
                  <ImageUploader
                    value={formData.imageUrl || undefined}
                    onChange={handleImageChange}
                    maxSizeInMB={10}
                    acceptedFormats={['image/jpeg', 'image/jpg', 'image/png', 'image/webp']}
                  />
                </div>

                {/* Caption Editor */}
                <PostCaptionEditor value={formData.caption} onChange={handleCaptionChange} />

                {/* Hashtag Editor */}
                <PostHashtagEditor hashtags={formData.hashtags} onChange={handleHashtagsChange} />

                {/* Scheduler */}
                <PostScheduler value={formData.scheduledAt} onChange={handleScheduledAtChange} />
              </div>
            ) : (
              <>
                {/* Image */}
                {post.imageUrl && (
                  <div className="mb-4 overflow-hidden rounded-lg bg-gray-100">
                    <img
                      src={post.imageUrl}
                      alt="Post content"
                      className="h-auto max-h-[400px] w-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                )}

                {/* Caption and Hashtags */}
                <div className="space-y-4">
                  <p className="whitespace-pre-wrap text-gray-700">{post.caption}</p>
                  <div className="flex flex-wrap gap-2">
                    {post.hashtags.map((tag, index) => (
                      <span key={index} className="text-blue-600">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Post Status Card */}
            {!isEditing && (
              <div className="mt-6">
                <PostStatusCard
                  status={post.status as 'draft' | 'scheduled' | 'published' | 'failed' | 'skipped'}
                  createdAt={post.createdAt}
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
                  {insights ? (
                    <MetricsGrid insights={insights} />
                  ) : (
                    <p className="py-8 text-center text-gray-500">
                      Metrics will be available once the post is published
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="comments" className="mt-6">
                  {commentsData?.comments && commentsData.comments.length > 0 ? (
                    <div className="max-h-[400px] space-y-4 overflow-y-auto">
                      {commentsData.comments.map(
                        (comment: { username: string; text: string }, index: number) => (
                          <div key={index} className="flex gap-3 rounded-lg bg-gray-50 p-3">
                            <div className="flex-1">
                              <p className="text-sm font-medium">{comment.username}</p>
                              <p className="mt-1 text-sm text-gray-700">{comment.text}</p>
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  ) : (
                    <p className="py-8 text-center text-gray-500">No comments yet</p>
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
                <span className="text-gray-600">Brand</span>
                <span className="font-medium">{post.brand.name}</span>
              </div>

              {post.scheduledAt && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Scheduled</span>
                  <span className="font-medium">
                    {formatInUserTimezone(post.scheduledAt, 'MMM d, h:mm a', timezone)}
                  </span>
                </div>
              )}

              {post.postedAt && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Published</span>
                  <span className="font-medium">
                    {formatInUserTimezone(post.postedAt, 'MMM d, h:mm a', timezone)}
                  </span>
                </div>
              )}

              {post.generationParams && (
                <>
                  <hr className="my-3" />
                  {post.generationParams.theme && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Theme</span>
                      <span className="font-medium">{post.generationParams.theme}</span>
                    </div>
                  )}
                  {post.generationParams.style && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Style</span>
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
