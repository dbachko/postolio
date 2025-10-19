import { useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '../lib/api';
import { useBrandStore } from '../stores/brandStore';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { ArrowLeft, Upload, Hash, Type, AlertCircle, Calendar, Clock } from 'lucide-react';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Input } from '../components/ui/input';
import { Alert, AlertDescription } from '../components/ui/alert';
import { validateImageFile } from '../lib/fileUtils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';

export function CreatePost() {
  const navigate = useNavigate();
  const location = useLocation();
  const { selectedBrand } = useBrandStore();
  const queryClient = useQueryClient();

  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string>('');
  const [scheduledAt, setScheduledAt] = useState<string>('');
  const [errors, setErrors] = useState<{
    caption?: string;
    hashtags?: string;
    image?: string;
  }>({});
  const [mutationError, setMutationError] = useState<string | null>(null);

  // Fetch campaigns for the dropdown
  const campaignsQuery = useQuery({
    queryKey: ['campaigns', selectedBrand?.id],
    queryFn: () => apiClient.listCampaigns(selectedBrand?.id),
    enabled: !!selectedBrand,
  });

  // Preselect default campaign when campaigns load
  useEffect(() => {
    if (!campaignId && campaignsQuery.data?.campaigns) {
      const def = campaignsQuery.data.campaigns.find((c) => c.isDefault);
      if (def) setCampaignId(def.id);
    }
  }, [campaignId, campaignsQuery.data]);

  // Prefill from query params (campaignId, scheduledAt)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const qCampaignId = params.get('campaignId');
    const qScheduledAt = params.get('scheduledAt');
    if (qCampaignId) {
      setCampaignId(qCampaignId);
    }
    if (qScheduledAt) {
      // Convert ISO date to datetime-local format in user's local timezone
      const d = new Date(qScheduledAt);
      if (!isNaN(d.getTime())) {
        const pad = (n: number) => String(n).padStart(2, '0');
        const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
          d.getHours()
        )}:${pad(d.getMinutes())}`;
        setScheduledAt(local);
      }
    }
  }, [location.search]);

  const createPostMutation = useMutation({
    mutationFn: async (data: {
      brandId: string;
      caption: string;
      hashtags: string[];
      imageFile?: File;
      campaignId?: string;
      scheduledAt?: string;
    }) => {
      return apiClient.createManualContent(data);
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['content'] });
      queryClient.invalidateQueries({ queryKey: ['calendar'] });

      // Show success toast with context
      const isScheduled = !!scheduledAt;
      const hasCampaign = !!campaignId;

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

      // Upsell toast if plan limit prevented scheduling
      if ((res as any)?.upsell?.upgradeRequired) {
        const msg =
          (res as any)?.upsell?.message ||
          'You’ve reached your plan’s scheduling limit. Upgrade to schedule more posts.';
        toast.info(msg);
      }

      // Navigate to content calendar where they can see the post
      navigate('/content');
    },
    onError: (error: Error) => {
      console.error('Failed to create post:', error);
      setMutationError(error.message || 'Failed to create post. Please try again.');
    },
  });

  const validateCaption = (value: string): string | undefined => {
    if (!value.trim()) {
      return 'Caption is required';
    }
    if (value.length > 2200) {
      return `Caption exceeds Instagram limit (${value.length}/2200 characters)`;
    }
    return undefined;
  };

  const validateHashtags = (value: string): string | undefined => {
    const tags = value.split(/[\s,]+/).filter((tag) => tag.length > 0);

    if (tags.length > 30) {
      return `Maximum 30 hashtags allowed (currently ${tags.length})`;
    }

    const invalidTags = tags.filter((tag) => {
      const cleanTag = tag.startsWith('#') ? tag.substring(1) : tag;
      return !/^[a-zA-Z0-9_]+$/.test(cleanTag);
    });

    if (invalidTags.length > 0) {
      return `Invalid hashtags: ${invalidTags.join(', ')}. Only letters, numbers, and underscores allowed`;
    }

    return undefined;
  };

  const validateImage = (file: File | null): string | undefined => {
    if (!file) return undefined;
    return validateImageFile(file, 10);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const error = validateImage(file);
      if (error) {
        setErrors((prev) => ({ ...prev, image: error }));
        return;
      }

      setErrors((prev) => ({ ...prev, image: undefined }));
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBrand) return;

    // Clear previous errors
    setErrors({});
    setMutationError(null);

    // Validate all fields
    const captionError = validateCaption(caption);
    const hashtagsError = validateHashtags(hashtags);
    const imageError = validateImage(imageFile);

    if (captionError || hashtagsError || imageError) {
      setErrors({
        caption: captionError,
        hashtags: hashtagsError,
        image: imageError,
      });
      return;
    }

    const hashtagArray = hashtags
      .split(/[\s,]+/)
      .filter((tag) => tag.length > 0)
      .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`));

    createPostMutation.mutate({
      brandId: selectedBrand.id,
      caption,
      hashtags: hashtagArray,
      imageFile: imageFile || undefined,
      campaignId: campaignId || undefined,
      scheduledAt: scheduledAt || undefined,
    });
  };

  if (!selectedBrand) {
    return (
      <div className="container mx-auto p-6">
        <Card className="p-6">
          <p className="text-muted-foreground">Please select a brand first</p>
          <Button onClick={() => navigate('/brands')} className="mt-4">
            Go to Brands
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6 flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Create New Post</h1>
        </div>
      </div>

      <Card className="p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Show mutation error */}
          {mutationError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{mutationError}</AlertDescription>
            </Alert>
          )}

          {/* Image Upload */}
          <div className="space-y-2">
            <Label htmlFor="image" className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Post Image
            </Label>
            <Input
              id="image"
              type="file"
              accept="image/*"
              onChange={handleImageChange}
              className={`cursor-pointer ${errors.image ? 'border-red-500' : ''}`}
              aria-label="Upload post image"
              aria-describedby={errors.image ? 'image-error' : 'image-help'}
              aria-invalid={!!errors.image}
            />
            {errors.image && (
              <p id="image-error" className="mt-1 text-sm text-red-500" role="alert">
                {errors.image}
              </p>
            )}
            {!errors.image && (
              <p id="image-help" className="text-muted-foreground sr-only text-sm">
                Upload an image for your post (optional, max 10MB)
              </p>
            )}
            {imagePreview && (
              <div className="mt-4">
                <img
                  src={imagePreview}
                  alt="Preview of uploaded image for Instagram post"
                  className="max-w-md rounded-lg border"
                />
              </div>
            )}
          </div>

          {/* Caption */}
          <div className="space-y-2">
            <Label htmlFor="caption" className="flex items-center gap-2">
              <Type className="h-4 w-4" />
              Caption <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="caption"
              value={caption}
              onChange={(e) => {
                setCaption(e.target.value);
                if (errors.caption) {
                  const error = validateCaption(e.target.value);
                  setErrors((prev) => ({ ...prev, caption: error }));
                }
              }}
              placeholder="Write your caption here..."
              className={`min-h-[150px] ${errors.caption ? 'border-red-500' : ''}`}
              maxLength={2200}
              required
              aria-label="Post caption"
              aria-describedby={errors.caption ? 'caption-error' : 'caption-help'}
              aria-invalid={!!errors.caption}
              aria-required="true"
            />
            {errors.caption && (
              <p id="caption-error" className="text-sm text-red-500" role="alert">
                {errors.caption}
              </p>
            )}
            <p
              id="caption-help"
              className={`text-sm ${caption.length > 2000 ? 'text-orange-500' : 'text-muted-foreground'}`}
              aria-live="polite"
            >
              {caption.length}/2200 characters
            </p>
          </div>

          {/* Hashtags */}
          <div className="space-y-2">
            <Label htmlFor="hashtags" className="flex items-center gap-2">
              <Hash className="h-4 w-4" />
              Hashtags
            </Label>
            <Input
              id="hashtags"
              value={hashtags}
              onChange={(e) => {
                setHashtags(e.target.value);
                if (errors.hashtags) {
                  const error = validateHashtags(e.target.value);
                  setErrors((prev) => ({ ...prev, hashtags: error }));
                }
              }}
              placeholder="Enter hashtags separated by spaces or commas"
              className={errors.hashtags ? 'border-red-500' : ''}
              aria-label="Post hashtags"
              aria-describedby={errors.hashtags ? 'hashtags-error' : 'hashtags-help'}
              aria-invalid={!!errors.hashtags}
            />
            {errors.hashtags && (
              <p id="hashtags-error" className="text-sm text-red-500" role="alert">
                {errors.hashtags}
              </p>
            )}
            <p id="hashtags-help" className="text-muted-foreground text-sm">
              Separate hashtags with spaces or commas (max 30)
            </p>
          </div>

          {/* Campaign (Optional) */}
          <div className="space-y-2">
            <Label htmlFor="campaign" className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Campaign (Optional)
            </Label>
            <Select value={campaignId} onValueChange={(value) => setCampaignId(value)}>
              <SelectTrigger id="campaign" aria-label="Select campaign">
                <SelectValue placeholder="Select a campaign (optional)" />
              </SelectTrigger>
              <SelectContent>
                {campaignsQuery.data?.campaigns
                  ?.filter((c) => ['active', 'preview'].includes(c.status))
                  .map((campaign) => (
                    <SelectItem key={campaign.id} value={campaign.id}>
                      {campaign.name}
                      {campaign.isDefault ? ' (Default)' : ''}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p
              className="text-muted-foreground text-sm"
              title="By default, new posts are assigned to the Default Campaign so nothing is lost. You can change it here."
            >
              Auto-assigns to Default Campaign; change if needed
            </p>
          </div>

          {/* Scheduled Time (Optional) */}
          <div className="space-y-2">
            <Label htmlFor="scheduledAt" className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Schedule Time (Optional)
            </Label>
            <Input
              id="scheduledAt"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              aria-label="Schedule post time"
              aria-describedby="schedule-help"
            />
            <p id="schedule-help" className="text-muted-foreground text-sm">
              Leave empty to save as draft, or set a time to schedule the post
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-4">
            <Button type="submit" disabled={!caption || createPostMutation.isPending}>
              {createPostMutation.isPending ? 'Creating...' : 'Create Post'}
            </Button>
            <Button type="button" variant="outline" onClick={() => navigate(-1)}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
