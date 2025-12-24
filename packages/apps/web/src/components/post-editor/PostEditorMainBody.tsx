import { useEffect, useMemo } from 'react';
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
  Film,
  Image as ImageIcon,
  Layers,
  Megaphone,
  MessageSquareText,
  Upload,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { getPlatformConfig, type Platform } from '@/lib/platform-config';

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
  isVideoMedia: boolean;
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
  isVideoMedia,
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
  showDestinationsPicker = true,
}: PostEditorMainBodyProps) {
  const destinationCount = selectedPlatformAccountIds?.length ?? 0;
  const isMultiDestinationSelection = destinationCount > 1;

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
    let allowed = allowedContentTypes.story;
    if (current === 'post') allowed = allowedContentTypes.post;
    else if (current === 'reel') allowed = allowedContentTypes.reel;

    if (allowed) return;
    if (!allowedContentTypes.post) return;
    setFormData((s) => ({ ...s, contentType: 'post' }));
  }, [allowedContentTypes, formData.contentType, selectedPlatforms.length, setFormData]);

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

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm">
              Content Type <span className="text-destructive">*</span>
            </Label>
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
              disabled={selectedPlatforms.length === 0}
            >
              <div className="flex-1">
                <RadioGroupItem
                  value="post"
                  id="type-post"
                  className="peer sr-only"
                  disabled={!allowedContentTypes.post}
                />
                <Label
                  htmlFor="type-post"
                  className="hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-accent/50 border-input bg-background flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 text-xs transition-all peer-disabled:pointer-events-none peer-disabled:opacity-50 sm:text-sm"
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  <span>Post</span>
                </Label>
              </div>
              <div className="flex-1">
                <RadioGroupItem
                  value="reel"
                  id="type-reel"
                  className="peer sr-only"
                  disabled={!allowedContentTypes.reel}
                />
                <Label
                  htmlFor="type-reel"
                  className="hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-accent/50 border-input bg-background flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 text-xs transition-all peer-disabled:pointer-events-none peer-disabled:opacity-50 sm:text-sm"
                >
                  <Film className="h-3.5 w-3.5" />
                  <span>Reel</span>
                </Label>
              </div>
              <div className="flex-1">
                <RadioGroupItem
                  value="story"
                  id="type-story"
                  className="peer sr-only"
                  disabled={!allowedContentTypes.story}
                />
                <Label
                  htmlFor="type-story"
                  className="hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-accent/50 border-input bg-background flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 text-xs transition-all peer-disabled:pointer-events-none peer-disabled:opacity-50 sm:text-sm"
                >
                  <Zap className="h-3.5 w-3.5" />
                  <span>Story</span>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {showDestinationsPicker ? (
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
              <VideoUploader
                value={formData.carouselAssets.find((asset) => asset.type === 'video')?.url || ''}
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
              <ChooseFromAssetsButton onClick={onOpenAssetPicker} />
              <div className="border-border bg-muted/40 flex items-center justify-between rounded-md border px-3 py-2">
                <div className="space-y-0.5">
                  <Label htmlFor="share-to-feed-toggle" className="text-xs font-medium">
                    Share to Feed
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    When enabled, this reel appears in both your feed grid and the Reels tab.
                  </p>
                </div>
                <CheckSwitch
                  id="share-to-feed-toggle"
                  checked={formData.shareToFeed}
                  onCheckedChange={(checked) =>
                    setFormData((s) => ({ ...s, shareToFeed: checked }))
                  }
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
              brandId={selectedBrand.id}
              maxImages={10}
              maxSizeInMB={10}
              maxVideoSizeInMB={300}
              acceptedVideoFormats={['video/mp4', 'video/quicktime', 'video/mpeg']}
              allowMixedMedia={allowMixedMedia}
              onChooseFromAssets={onOpenAssetPicker}
            />
          )}
        </div>

        {formData.contentType !== 'story' ? (
          <>
            <PostCaptionEditor
              value={formData.caption}
              onChange={(v) => setFormData((s) => ({ ...s, caption: v }))}
              brandId={selectedBrand.id}
              disabled={false}
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
                  id="first-comment-toggle"
                  checked={firstCommentOpen}
                  onCheckedChange={setFirstCommentOpen}
                />
              </div>
              {firstCommentOpen ? (
                <PostCaptionEditor
                  id="firstComment"
                  hideLabel={true}
                  value={formData.firstComment || ''}
                  onChange={(v) => setFormData((s) => ({ ...s, firstComment: v }))}
                  brandId={selectedBrand.id}
                  placeholder="Write a caption with text, links..."
                  minHeight="min-h-24"
                  maxLength={2200}
                  disabled={false}
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
            disabled={false}
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
  }

  // Edit mode
  if (isLoading || !post) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Loading...
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

      <div className="space-y-2">
        <Label>{isVideoMedia ? 'Video' : 'Post Media'}</Label>
        {(() => {
          if (isVideoMedia) {
            const videoUrl =
              formData.carouselAssets.find((asset) => asset.type === 'video')?.url || '';
            if (!videoUrl) {
              return <div className="text-muted-foreground text-sm">No video</div>;
            }
            return (
              <div className="bg-muted flex items-center justify-center overflow-hidden rounded-lg">
                <video src={videoUrl} className="h-[250px] w-full object-contain" controls />
              </div>
            );
          }

          return (
            <div className="space-y-2">
              {post.brand?.id ? (
                <MultiImageUploader
                  value={formData.carouselAssets}
                  onChange={(assets) =>
                    setFormData((s) => ({
                      ...s,
                      carouselAssets: assets,
                    }))
                  }
                  brandId={post.brand.id}
                  maxImages={10}
                  maxSizeInMB={10}
                  enableUpload={false}
                  allowMixedMedia={allowMixedMedia}
                />
              ) : null}
              {!formData.carouselAssets.length ? (
                <div className="text-muted-foreground text-sm">No image</div>
              ) : null}
            </div>
          );
        })()}

        {!disabled ? (
          <div className="flex flex-col gap-2">
            {post.brand?.id ? (
              <ChooseFromAssetsButton
                onClick={onOpenAssetPicker}
                size="compact"
                fullWidth={false}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {formData.contentType !== 'story' ? (
        <>
          <PostCaptionEditor
            value={formData.caption}
            onChange={(v) => setFormData((s) => ({ ...s, caption: v }))}
            brandId={post.brand?.id}
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
                id="first-comment-toggle-edit"
                checked={firstCommentOpen}
                onCheckedChange={setFirstCommentOpen}
                disabled={disabled}
              />
            </div>
            {firstCommentOpen ? (
              <PostCaptionEditor
                id="firstComment-edit"
                hideLabel={true}
                value={formData.firstComment || ''}
                onChange={(v) => setFormData((s) => ({ ...s, firstComment: v }))}
                brandId={post.brand?.id}
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
            <SelectValue placeholder="Select a campaign" />
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
}
