import { useState, useEffect, useRef, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useTimezone } from '../contexts/TimezoneContext';
import { convertLocalToUTC } from '../lib/timezone';
import { content as contentApi, type Content } from '../lib/api';
import {
  validateContentPayload,
  type InstagramContentType,
  type InstagramMediaType,
} from '@postolio/content-validation';
import { ImageUploader } from './ImageUploader';
import { VideoUploader } from './VideoUploader';
import { PostCaptionEditor } from './PostCaptionEditor';
import { PostHashtagEditor } from './PostHashtagEditor';
import { PostScheduler } from './PostScheduler';
import { PostStatusCard } from './PostStatusCard';
import { PostSaveIndicator, type SaveStatus } from './PostSaveIndicator';
import { PostLearningFeedback } from './PostLearningFeedback';
import { usePostSchedulerStore } from '../stores/postSchedulerStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Save, Image as ImageIcon, Video as VideoIcon } from 'lucide-react';
import { toast } from 'sonner';

interface PostEditorModalProps {
  content: Content | null;
  isOpen: boolean;
  onClose: () => void;
}

interface FormData {
  caption: string;
  hashtags: string[];
  imageUrl: string;
  videoUrl?: string;
  mediaType: InstagramMediaType;
  scheduledAt: string;
}

export function PostEditorModal({ content, isOpen, onClose }: PostEditorModalProps) {
  const queryClient = useQueryClient();
  const resetSchedulerStore = usePostSchedulerStore((state) => state.reset);
  const [formData, setFormData] = useState<FormData>({
    caption: '',
    hashtags: [],
    imageUrl: '',
    videoUrl: '',
    mediaType: 'image',
    scheduledAt: '',
  });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [showLearningMessage, setShowLearningMessage] = useState(false);
  const objectUrlRef = useRef<string | null>(null); // Track object URLs for cleanup
  const originalDataRef = useRef<FormData | null>(null); // Track original data for comparison
  const [learningFeedback, setLearningFeedback] = useState<{
    isVisible: boolean;
    message: string;
    appliedToFuturePosts?: number;
  }>({ isVisible: false, message: '' });

  // Helper function to update content in cache
  const updateContentInCache = (updatedContent: Content) => {
    queryClient.setQueryData(
      ['contentHistory', updatedContent.id],
      (oldData: { content: Content[] } | undefined) => {
        if (oldData?.content) {
          return {
            ...oldData,
            content: oldData.content.map((item: Content) =>
              item.id === updatedContent.id ? { ...item, ...updatedContent } : item
            ),
          };
        }
        return oldData;
      }
    );
  };

  // Initialize form data when content changes
  useEffect(() => {
    if (content && isOpen) {
      // Determine media type from content
      const hasVideo = !!(content as any).videoUrl;
      const mediaType: InstagramMediaType = hasVideo ? 'video' : 'image';

      const initialData: FormData = {
        caption: content.caption || '',
        hashtags: (content.hashtags || []).map((t: string) => (t.startsWith('#') ? t.slice(1) : t)),
        imageUrl: content.imageUrl || '',
        videoUrl: (content as any).videoUrl || '',
        mediaType,
        scheduledAt: content.scheduledAt
          ? format(new Date(content.scheduledAt), "yyyy-MM-dd'T'HH:mm")
          : '',
      };
      setFormData(initialData);
      originalDataRef.current = initialData;
      setHasChanges(false);
      setShowLearningMessage(false);
    }
  }, [content, isOpen]);

  // Reset form data when modal is closed
  useEffect(() => {
    if (!isOpen) {
      console.log('Modal closed - resetting form data');
      setFormData({
        caption: '',
        hashtags: [],
        imageUrl: '',
        videoUrl: '',
        mediaType: 'image',
        scheduledAt: '',
      });
      setLearningFeedback({ isVisible: false, message: '' });
      setSaveStatus('idle');
      setHasChanges(false);
      setShowLearningMessage(false);
      originalDataRef.current = null;
      // Reset the scheduler store to clear any editing state
      resetSchedulerStore();
      // Clean up object URL when modal closes
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    }
  }, [isOpen, resetSchedulerStore]);

  // Clean up object URL on component unmount
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  // Check for changes and show learning message
  const checkForChanges = (newData: FormData) => {
    if (!originalDataRef.current) return false;

    const hasFormChanges =
      newData.caption !== originalDataRef.current.caption ||
      JSON.stringify(newData.hashtags) !== JSON.stringify(originalDataRef.current.hashtags) ||
      newData.imageUrl !== originalDataRef.current.imageUrl ||
      newData.scheduledAt !== originalDataRef.current.scheduledAt;

    setHasChanges(hasFormChanges);

    // Show learning message when user makes edits to caption or hashtags
    if (hasFormChanges && !showLearningMessage) {
      const textChanged =
        newData.caption !== originalDataRef.current.caption ||
        JSON.stringify(newData.hashtags) !== JSON.stringify(originalDataRef.current.hashtags);
      if (textChanged) {
        setShowLearningMessage(true);
      }
    }

    return hasFormChanges;
  };

  const updateContentMutation = useMutation({
    mutationFn: (data: {
      contentId: string;
      caption?: string;
      hashtags?: string[];
      imageUrl?: string;
      scheduledAt?: string;
    }) => {
      // Critical logging before mutation
      console.log('MUTATION CALL:', {
        contentId: data.contentId,
        caption: data.caption,
        captionLength: data.caption?.length || 0,
        hashtags: data.hashtags,
        imageUrl: data.imageUrl,
        scheduledAt: data.scheduledAt,
        scheduledAtType: typeof data.scheduledAt,
      });

      // Final safety check before API call
      if (!data.caption || data.caption.trim().length === 0) {
        console.error('CRITICAL ERROR: Attempting to call API with empty caption!', data);
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
        // Note: Notification will persist until user manually closes it
      }

      // Update the content in relevant queries
      updateContentInCache(response.content);

      // Cache is already updated, no need to invalidate

      // Show "AI is learning" message briefly
      setTimeout(() => {
        setSaveStatus('idle');
      }, 2000);

      // Upsell toast if plan limit prevents scheduling
      if ((response as any)?.upsell?.upgradeRequired) {
        const msg =
          (response as any)?.upsell?.message ||
          'You’ve reached your plan’s scheduling limit. Upgrade to schedule more posts.';
        toast.info(msg);
      }
    },
    onError: (error) => {
      setSaveStatus('error');
      console.error('Failed to update content:', error);

      setTimeout(() => {
        setSaveStatus('idle');
      }, 3000);
    },
  });
  const { timezone } = useTimezone();

  // Manual save function
  const saveChanges = async () => {
    if (!content || !hasChanges) return;

    if (!validation.ok) {
      toast.error(validationError || 'Please fix validation errors before saving');
      return;
    }

    console.log('💾 Manually saving content:', {
      contentId: content.id,
      caption: formData.caption.substring(0, 30) + '...',
      timestamp: new Date().toISOString(),
    });

    // Convert scheduledAt from local input to UTC ISO if present
    const payloadScheduledAt = formData.scheduledAt
      ? convertLocalToUTC(new Date(formData.scheduledAt), timezone).toISOString()
      : undefined;

    updateContentMutation.mutate({
      contentId: content.id,
      caption: formData.caption,
      hashtags: formData.hashtags,
      imageUrl: formData.imageUrl || undefined,
      scheduledAt: payloadScheduledAt,
    });

    // Update the original data reference after successful save
    originalDataRef.current = formData;
    setHasChanges(false);
  };

  const handleCaptionChange = (value: string) => {
    const newData = { ...formData, caption: value };
    setFormData(newData);
    checkForChanges(newData);
  };

  const handleHashtagsChange = (hashtags: string[]) => {
    const newData = { ...formData, hashtags };
    setFormData(newData);
    checkForChanges(newData);
  };

  const handleImageChange = async (fileOrUrl: string | File) => {
    if (typeof fileOrUrl === 'string') {
      // Direct URL update (e.g., when removing the image)
      const newData = { ...formData, imageUrl: fileOrUrl };
      setFormData(newData);
      checkForChanges(newData);
    } else {
      // File upload - create local preview immediately
      // Revoke previous object URL if it exists
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
      const objectUrl = URL.createObjectURL(fileOrUrl);
      objectUrlRef.current = objectUrl;
      setFormData((prev) => ({ ...prev, imageUrl: objectUrl }));

      // Upload to server
      if (content) {
        setSaveStatus('saving');
        try {
          if (!content.brandId) {
            throw new Error('Missing brand information for upload');
          }
          const response = await contentApi.uploadContentImage(
            content.id,
            content.brandId,
            fileOrUrl
          );
          if (response.success && response.content) {
            // Update with the server's response - use imageUrl if available
            const newImageUrl = response.content.imageUrl || objectUrl;
            const newData = { ...formData, imageUrl: newImageUrl };
            setFormData(newData);
            checkForChanges(newData);
            setSaveStatus('saved');
            setLastSaved(new Date());

            // Clean up the object URL since we now have the server URL
            if (objectUrlRef.current) {
              URL.revokeObjectURL(objectUrlRef.current);
              objectUrlRef.current = null;
            }

            // Update the content in cache without mutating the original
            updateContentInCache({
              ...content,
              imageUrl: response.content.imageUrl,
            });

            // Cache is already updated, no need to invalidate

            setTimeout(() => {
              setSaveStatus('idle');
            }, 2000);
          }
        } catch (error) {
          console.error('Failed to upload image:', error);
          setSaveStatus('error');
          // Revert to previous image on error
          setFormData((prev) => ({
            ...prev,
            imageUrl: content.imageUrl || '',
          }));
          setTimeout(() => {
            setSaveStatus('idle');
          }, 3000);
        }
      }
    }
  };

  const validation = useMemo(() => {
    if (!content) return { ok: true, errors: [] as any[] };
    const mediaKeys: string[] = [];
    if (formData.imageUrl) mediaKeys.push(formData.imageUrl);
    return validateContentPayload({
      platform: 'instagram',
      contentType: (content.contentType as InstagramContentType) || 'post',
      mediaType: formData.mediaType,
      caption: formData.caption,
      hashtags: formData.hashtags,
      mediaKeys,
      videoUrl: formData.videoUrl || undefined,
    });
  }, [
    content,
    formData.caption,
    formData.hashtags,
    formData.imageUrl,
    formData.mediaType,
    formData.videoUrl,
  ]);

  const validationError = validation.ok ? null : validation.errors[0]?.message;

  const handleVideoChange = (url: string) => {
    // VideoUploader handles the upload internally and returns the CDN URL
    const newData = { ...formData, videoUrl: url };
    setFormData(newData);
    checkForChanges(newData);
  };

  const handleMediaTypeChange = (newMediaType: 'image' | 'video') => {
    const newData = { ...formData, mediaType: newMediaType };
    setFormData(newData);
    checkForChanges(newData);
  };

  const handleScheduledAtChange = (value: string) => {
    console.log('Scheduled time changed:', {
      from: formData.scheduledAt,
      to: value,
      contentId: content?.id,
    });
    const newData = { ...formData, scheduledAt: value };
    setFormData(newData);
    checkForChanges(newData);
  };

  const handleClose = async () => {
    if (hasChanges) {
      await saveChanges();
    }
    setSaveStatus('idle');
    setLastSaved(null);
    onClose();
  };

  const handleDismissLearning = () => {
    setLearningFeedback({ isVisible: false, message: '' });
  };

  if (!content) return null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          void handleClose();
        }
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Post</DialogTitle>
          <PostSaveIndicator
            status={saveStatus}
            lastSaved={lastSaved}
            showAILearningMessage={showLearningMessage && hasChanges}
            idleHint="Click Save to apply your edits"
          />
        </DialogHeader>

        <PostLearningFeedback
          isVisible={learningFeedback.isVisible}
          message={learningFeedback.message}
          appliedToFuturePosts={learningFeedback.appliedToFuturePosts}
          onDismiss={handleDismissLearning}
          className="mb-4"
        />

        <div className="space-y-6">
          <PostCaptionEditor value={formData.caption} onChange={handleCaptionChange} />

          <PostHashtagEditor hashtags={formData.hashtags} onChange={handleHashtagsChange} />

          {/* Media Upload - Tabs for Image/Video */}
          <div className="space-y-2">
            <Label>Post Media</Label>
            <Tabs
              value={formData.mediaType}
              onValueChange={(value) => handleMediaTypeChange(value as 'image' | 'video')}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="image" className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4" />
                  Image
                </TabsTrigger>
                <TabsTrigger value="video" className="flex items-center gap-2">
                  <VideoIcon className="h-4 w-4" />
                  Video
                </TabsTrigger>
              </TabsList>

              <TabsContent value="image" className="mt-4">
                <ImageUploader
                  value={formData.imageUrl || content.imageUrl || undefined}
                  onChange={handleImageChange}
                  maxSizeInMB={10}
                  acceptedFormats={['image/jpeg', 'image/jpg', 'image/png', 'image/webp']}
                />
              </TabsContent>

              <TabsContent value="video" className="mt-4">
                {content?.brandId && (
                  <VideoUploader
                    value={formData.videoUrl}
                    onChange={handleVideoChange}
                    brandId={content.brandId}
                    maxSizeInMB={300}
                    acceptedFormats={['video/mp4', 'video/quicktime', 'video/mpeg']}
                  />
                )}
              </TabsContent>
            </Tabs>
          </div>

          <PostScheduler
            contentId={content.id}
            value={formData.scheduledAt}
            onChange={handleScheduledAtChange}
          />

          <PostStatusCard
            status={content.status as 'draft' | 'scheduled' | 'published' | 'failed' | 'skipped'}
            createdAt={content.createdAt}
            errorMessage={content.schedulingError || null}
          />
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {!validation.ok && (
            <p className="text-destructive text-sm">
              {validationError || 'Please fix validation errors before saving.'}
            </p>
          )}
          <Button
            onClick={saveChanges}
            disabled={!hasChanges || updateContentMutation.isPending || !validation.ok}
            className="flex items-center gap-2"
          >
            <Save className="h-4 w-4" />
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
