import { useEffect, useMemo, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CheckSwitch } from '@/components/ui/check-switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AppEmptyState } from '@/components/AppEmptyState';
import { ChooseFromAssetsButton } from '@/components/ChooseFromAssetsButton';
import { MultiImageUploader, type AssetReference } from '@/components/MultiImageUploader';
import { PostCaptionEditor } from '@/components/PostCaptionEditor';
import {
  SocialAccountsPicker,
  type SocialAccountsPickerOption,
} from '@/components/social/SocialAccountsPicker';
import { VideoUploader } from '@/components/VideoUploader';
import type { PostDetailData } from '@/hooks/usePostDetail';
import type { Brand, Campaign } from '@/lib/api';
import type { InstagramContentType } from '@postolio/content-validation';
import {
  CircleFadingPlus,
  Film,
  Image as ImageIcon,
  Layers,
  Megaphone,
  MessageSquareText,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { getPlatformConfig, type Platform } from '@/lib/platform-config';
import { cn } from '@/lib/utils';

export interface PostEditorFormState {
  caption: string;
  carouselAssets: AssetReference[];
  contentType: InstagramContentType;
  scheduledAt: string;
  shareToFeed: boolean;
  firstComment: string;
}

interface PostEditorMainBodyProps {
  mode: 'create' | 'edit';
  allowMixedMedia: boolean;
  disabled: boolean;
  isLoading: boolean;
  post?: PostDetailData;
  selectedBrand: Brand | null;
  formData: PostEditorFormState;
  setFormData: (updater: (prev: PostEditorFormState) => PostEditorFormState) => void;
  firstCommentOpen: boolean;
  setFirstCommentOpen: (open: boolean) => void;
  campaigns: Campaign[];
  isLoadingCampaigns: boolean;
  selectedCampaign: string | null;
  setSelectedCampaign: (campaignId: string | null) => void;
  selectedCampaignPaused: boolean;
  onOpenAssetPicker: () => void;
  platformOptions?: SocialAccountsPickerOption[];
  selectedPlatformAccountIds?: string[];
  onSelectedPlatformAccountIdsChange?: (value: string[]) => void;
  showDestinationsPicker?: boolean;
}

export function PostEditorMainBody({
  mode,
  allowMixedMedia,
  disabled,
  isLoading,
  post,
  selectedBrand,
  formData,
  setFormData,
  firstCommentOpen,
  setFirstCommentOpen,
  campaigns,
  isLoadingCampaigns,
  selectedCampaign,
  setSelectedCampaign,
  selectedCampaignPaused,
  onOpenAssetPicker,
  platformOptions,
  selectedPlatformAccountIds,
  onSelectedPlatformAccountIdsChange,
  showDestinationsPicker,
}: PostEditorMainBodyProps) {
  const resolvedShowDestinationsPicker = showDestinationsPicker ?? mode === 'create';
  const destinationCount = selectedPlatformAccountIds?.length ?? 0;
  const isMultiDestinationSelection = destinationCount > 1;

  const mediaSummary = useMemo(() => {
    const assets = formData.carouselAssets || [];
    const images = assets.filter((asset) => asset.type === 'image').length;
    const videos = assets.filter((asset) => asset.type === 'video').length;
    return {
      total: assets.length,
      images,
      videos,
      hasImages: images > 0,
      hasVideos: videos > 0,
    };
  }, [formData.carouselAssets]);

  const selectedPlatforms = useMemo(() => {
    if (!platformOptions || !selectedPlatformAccountIds) return [];
    const byId = new Map(platformOptions.map((opt) => [opt.id, opt.platform]));
    const out = new Set<Platform>();
    for (const id of selectedPlatformAccountIds) {
      const platform = byId.get(id);
      if (platform) out.add(platform);
    }
    return Array.from(out);
  }, [platformOptions, selectedPlatformAccountIds]);

  const allowedContentTypes = useMemo(() => {
    if (selectedPlatforms.length === 0) {
      return { post: false, reel: false, story: false };
    }
    const post = selectedPlatforms.every((p) => getPlatformConfig(p).features.publishing);
    const reel = selectedPlatforms.every((p) => getPlatformConfig(p).features.reels);
    const story = selectedPlatforms.every((p) => getPlatformConfig(p).features.stories);
    return { post, reel, story };
  }, [selectedPlatforms]);

  const contentTypeDisabledReasons = useMemo(() => {
    const reasons: Record<InstagramContentType, string | null> = {
      post: allowedContentTypes.post
        ? null
        : 'Posts are not available for the selected destinations.',
      reel: null,
      story: null,
    };

    if (!allowedContentTypes.reel) {
      reasons.reel = 'Reels are not available for the selected destinations.';
    } else if (mediaSummary.total > 0) {
      if (!mediaSummary.hasVideos) {
        reasons.reel = 'Reels require a video. Remove images and upload a video.';
      } else if (mediaSummary.hasImages) {
        reasons.reel = 'Reels can only include a single video. Remove images first.';
      } else if (mediaSummary.videos > 1) {
        reasons.reel = 'Reels can only include one video. Remove extra videos.';
      }
    }

    if (!allowedContentTypes.story) {
      reasons.story = 'Stories are not available for the selected destinations.';
    } else if (mediaSummary.total > 1) {
      reasons.story = 'Stories support only one media item. Remove extra media.';
    }

    return reasons;
  }, [allowedContentTypes.post, allowedContentTypes.reel, allowedContentTypes.story, mediaSummary]);

  const renderContentTypeLabel = (opts: {
    id: string;
    label: string;
    icon: ReactNode;
    disabledReason: string | null;
  }) => {
    const isDisabled = Boolean(opts.disabledReason);
    const base = (
      <Label
        htmlFor={opts.id}
        aria-disabled={isDisabled}
        className={cn(
          'peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-accent/50 border-input bg-background flex h-10 items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-all sm:text-sm',
          isDisabled
            ? 'cursor-not-allowed opacity-50'
            : 'hover:bg-accent hover:text-accent-foreground cursor-pointer'
        )}
      >
        {opts.icon}
        <span>{opts.label}</span>
      </Label>
    );

    if (!opts.disabledReason) return base;

    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>{base}</TooltipTrigger>
        <TooltipContent>
          <p className="text-sm">{opts.disabledReason}</p>
        </TooltipContent>
      </Tooltip>
    );
  };

  const campaignSelectItems = useMemo(() => {
    if (isLoadingCampaigns) {
      return (
        <SelectItem value="__loading" disabled>
          Loading campaigns...
        </SelectItem>
      );
    }

    if (campaigns.length === 0) {
      return (
        <SelectItem value="__empty" disabled>
          No campaigns found
        </SelectItem>
      );
    }

    return campaigns.map((campaign) => (
      <SelectItem key={campaign.id} value={campaign.id}>
        {campaign.name}
        {campaign.status === 'paused' ? ' (paused)' : ''}
      </SelectItem>
    ));
  }, [campaigns, isLoadingCampaigns]);

  useEffect(() => {
    if (selectedPlatforms.length === 0) return;
    const current = formData.contentType;
    const currentDisabledReason = contentTypeDisabledReasons[current];
    if (!currentDisabledReason) return;

    const firstEnabled: InstagramContentType | null = !contentTypeDisabledReasons.post
      ? 'post'
      : !contentTypeDisabledReasons.reel
        ? 'reel'
        : !contentTypeDisabledReasons.story
          ? 'story'
          : null;
    if (!firstEnabled) return;
    if (firstEnabled === current) return;
    setFormData((s) => ({ ...s, contentType: firstEnabled }));
  }, [contentTypeDisabledReasons, formData.contentType, selectedPlatforms.length, setFormData]);

  const renderComposerBody = (opts: { brandId: string }) => {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm">
              Content Type <span className="text-destructive">*</span>
            </Label>
            <TooltipProvider>
              <RadioGroup
                value={formData.contentType}
                onValueChange={(value) =>
                  setFormData((s) => {
                    const nextType = value as InstagramContentType;
                    if (nextType !== 'reel') {
                      return { ...s, contentType: nextType };
                    }

                    const firstVideo = s.carouselAssets.find((asset) => asset.type === 'video');
                    return {
                      ...s,
                      contentType: nextType,
                      carouselAssets: firstVideo ? [firstVideo] : [],
                    };
                  })
                }
                className="flex gap-2"
                disabled={disabled || selectedPlatforms.length === 0}
              >
                <div className="flex-1">
                  <RadioGroupItem
                    value="post"
                    id={mode === 'create' ? 'type-post' : 'edit-type-post'}
                    className="peer sr-only"
                    disabled={Boolean(contentTypeDisabledReasons.post)}
                  />
                  {renderContentTypeLabel({
                    id: mode === 'create' ? 'type-post' : 'edit-type-post',
                    label: 'Post',
                    icon: <ImageIcon className="h-3.5 w-3.5" />,
                    disabledReason: contentTypeDisabledReasons.post,
                  })}
                </div>
                <div className="flex-1">
                  <RadioGroupItem
                    value="reel"
                    id={mode === 'create' ? 'type-reel' : 'edit-type-reel'}
                    className="peer sr-only"
                    disabled={Boolean(contentTypeDisabledReasons.reel)}
                  />
                  {renderContentTypeLabel({
                    id: mode === 'create' ? 'type-reel' : 'edit-type-reel',
                    label: 'Reel',
                    icon: <Film className="h-3.5 w-3.5" />,
                    disabledReason: contentTypeDisabledReasons.reel,
                  })}
                </div>
                <div className="flex-1">
                  <RadioGroupItem
                    value="story"
                    id={mode === 'create' ? 'type-story' : 'edit-type-story'}
                    className="peer sr-only"
                    disabled={Boolean(contentTypeDisabledReasons.story)}
                  />
                  {renderContentTypeLabel({
                    id: mode === 'create' ? 'type-story' : 'edit-type-story',
                    label: 'Story',
                    icon: <CircleFadingPlus className="h-3.5 w-3.5" />,
                    disabledReason: contentTypeDisabledReasons.story,
                  })}
                </div>
              </RadioGroup>
            </TooltipProvider>
          </div>

          {resolvedShowDestinationsPicker ? (
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-sm">
                Destinations <span className="text-destructive">*</span>
                {isMultiDestinationSelection ? (
                  <Badge variant="secondary" className="gap-1 text-[11px] font-medium">
                    <Layers className="h-3 w-3" />
                    <span>{destinationCount} destinations</span>
                  </Badge>
                ) : destinationCount === 1 ? (
                  <Badge
                    variant="outline"
                    className="text-muted-foreground text-[11px] font-medium"
                  >
                    Single destination
                  </Badge>
                ) : null}
              </Label>
              {platformOptions &&
              selectedPlatformAccountIds &&
              onSelectedPlatformAccountIdsChange ? (
                <SocialAccountsPicker
                  options={platformOptions}
                  value={selectedPlatformAccountIds}
                  onChange={onSelectedPlatformAccountIdsChange}
                  disabled={disabled}
                  size="md"
                  required
                  selectedLayout="wrap"
                  addTooltip="Add destination"
                />
              ) : (
                <Skeleton className="h-10 w-full" />
              )}
              {isMultiDestinationSelection ? (
                <p className="text-muted-foreground text-xs">
                  This will create a grouped post. After saving, you can customize each destination
                  in tabs.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Media <span className="text-destructive">*</span>
          </Label>

          {formData.contentType === 'reel' ? (
            <div className="space-y-3">
              {disabled ? (
                <MultiImageUploader
                  value={formData.carouselAssets}
                  onChange={() => {}}
                  brandId={opts.brandId}
                  enableUpload={false}
                />
              ) : (
                <>
                  <VideoUploader
                    value={
                      formData.carouselAssets.find((asset) => asset.type === 'video')?.url || ''
                    }
                    onChange={(url, meta) => {
                      const assetId = meta?.assetId;
                      if (url && !assetId) {
                        toast.error('Video upload missing asset ID. Please try again.');
                        return;
                      }
                      setFormData((s) => ({
                        ...s,
                        carouselAssets: url && assetId ? [{ id: assetId, url, type: 'video' }] : [],
                      }));
                    }}
                    brandId={opts.brandId}
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
                  <ChooseFromAssetsButton onClick={onOpenAssetPicker} />
                </>
              )}
              <div className="border-border bg-muted/40 flex items-center justify-between rounded-md border px-3 py-2">
                <div className="space-y-0.5">
                  <Label
                    htmlFor={
                      mode === 'create' ? 'share-to-feed-toggle' : 'share-to-feed-toggle-edit'
                    }
                    className="text-xs font-medium"
                  >
                    Share to Feed
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    When enabled, this reel appears in both your feed grid and the Reels tab.
                  </p>
                </div>
                <CheckSwitch
                  id={mode === 'create' ? 'share-to-feed-toggle' : 'share-to-feed-toggle-edit'}
                  checked={formData.shareToFeed}
                  onCheckedChange={(checked) =>
                    setFormData((s) => ({ ...s, shareToFeed: checked }))
                  }
                  disabled={disabled}
                />
              </div>
            </div>
          ) : (
            <MultiImageUploader
              value={formData.carouselAssets}
              onChange={(assets) =>
                setFormData((s) => ({
                  ...s,
                  carouselAssets: assets,
                }))
              }
              brandId={opts.brandId}
              maxImages={10}
              maxSizeInMB={10}
              maxVideoSizeInMB={300}
              acceptedVideoFormats={['video/mp4', 'video/quicktime', 'video/mpeg']}
              allowMixedMedia={allowMixedMedia}
              enableUpload={!disabled}
              onChooseFromAssets={disabled ? undefined : onOpenAssetPicker}
            />
          )}
        </div>

        {formData.contentType !== 'story' ? (
          <>
            <PostCaptionEditor
              value={formData.caption}
              onChange={(v) => setFormData((s) => ({ ...s, caption: v }))}
              brandId={mode === 'create' ? selectedBrand?.id : post?.brand?.id}
              disabled={disabled}
              showIcon={true}
            />

            <div className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <Label className="flex items-center gap-2">
                    <MessageSquareText className="h-4 w-4" />
                    First comment
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    Publish a first comment with your post.
                  </p>
                </div>
                <CheckSwitch
                  id={mode === 'create' ? 'first-comment-toggle' : 'first-comment-toggle-edit'}
                  checked={firstCommentOpen}
                  onCheckedChange={setFirstCommentOpen}
                  disabled={disabled}
                />
              </div>
              {firstCommentOpen ? (
                <PostCaptionEditor
                  id={mode === 'create' ? 'firstComment' : 'firstComment-edit'}
                  hideLabel={true}
                  value={formData.firstComment || ''}
                  onChange={(v) => setFormData((s) => ({ ...s, firstComment: v }))}
                  brandId={mode === 'create' ? selectedBrand?.id : post?.brand?.id}
                  placeholder="Write a caption with text, links..."
                  minHeight="min-h-24"
                  maxLength={2200}
                  disabled={disabled}
                  showIcon={false}
                />
              ) : null}
            </div>
          </>
        ) : null}

        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Megaphone className="h-4 w-4" />
            Campaign
          </Label>
          <Select
            value={selectedCampaign || undefined}
            onValueChange={(v) => setSelectedCampaign(v)}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a campaign (optional)" />
            </SelectTrigger>
            <SelectContent>{campaignSelectItems}</SelectContent>
          </Select>
          {selectedCampaignPaused ? (
            <p className="text-muted-foreground text-xs">
              This campaign is paused. You can still save this post as a draft, but you can&apos;t
              schedule it until the campaign is resumed.
            </p>
          ) : null}
        </div>
      </div>
    );
  };

  if (mode === 'create') {
    if (!selectedBrand) {
      return (
        <AppEmptyState
          variant="minimal"
          title="Select a brand to create this post"
          description="Post drafts, scheduling rules, and insights are tied to the brand you choose."
          actions={[{ label: 'Choose Brand', to: '/brands' }]}
          className="min-h-[280px]"
        />
      );
    }
    return renderComposerBody({ brandId: selectedBrand.id });
  }

  // Edit mode
  if (isLoading || !post) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Loading...
      </div>
    );
  }

  const brandId = post.brand?.id || selectedBrand?.id || null;
  if (!brandId) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Missing brand
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {post.status === 'failed' && post.schedulingError ? (
        <Alert variant="destructive">
          <AlertDescription>{post.schedulingError}</AlertDescription>
        </Alert>
      ) : null}
      {renderComposerBody({ brandId })}
    </div>
  );
}
