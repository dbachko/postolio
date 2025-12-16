import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { AppEmptyState } from '@/components/AppEmptyState';
import { ChooseFromAssetsButton } from '@/components/ChooseFromAssetsButton';
import { MultiImageUploader, type AssetReference } from '@/components/MultiImageUploader';
import { PostCaptionEditor } from '@/components/PostCaptionEditor';
import { VideoUploader } from '@/components/VideoUploader';
import type { PostDetailData } from '@/hooks/usePostDetail';
import type { Brand, Campaign } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { InstagramContentType } from '@postolio/content-validation';
import { ChevronDown, Film, Image as ImageIcon, Megaphone, Upload, Zap } from 'lucide-react';
import { toast } from 'sonner';

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
}: PostEditorMainBodyProps) {
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
        <div className="space-y-2">
          <Label className="text-sm">Content Type</Label>
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
                <Switch
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
                <PostCaptionEditor
                  id="firstComment"
                  label="First Comment"
                  required={false}
                  value={formData.firstComment || ''}
                  onChange={(v) => setFormData((s) => ({ ...s, firstComment: v }))}
                  brandId={selectedBrand.id}
                  placeholder="Add hashtags, links, or CTAs..."
                  minHeight="min-h-24"
                  maxLength={2200}
                  disabled={false}
                  showIcon={false}
                  helperText={
                    <span className="italic">Posts automatically when your content goes live</span>
                  }
                />
              </CollapsibleContent>
            </Collapsible>
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
        {isVideoMedia ? (
          formData.carouselAssets.find((asset) => asset.type === 'video')?.url ? (
            <div className="bg-muted overflow-hidden rounded-lg">
              <video
                src={formData.carouselAssets.find((asset) => asset.type === 'video')!.url}
                className="h-auto max-h-[250px] w-full object-cover"
                controls
              />
            </div>
          ) : (
            <div className="text-muted-foreground text-sm">No video</div>
          )
        ) : (
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
        )}

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
              <PostCaptionEditor
                id="firstComment-edit"
                label="First Comment"
                required={false}
                value={formData.firstComment || ''}
                onChange={(v) => setFormData((s) => ({ ...s, firstComment: v }))}
                brandId={post.brand?.id}
                placeholder="Add hashtags, links, or CTAs..."
                minHeight="min-h-24"
                maxLength={2200}
                disabled={disabled}
                showIcon={false}
                helperText={
                  <span className="italic">Posts automatically when your content goes live</span>
                }
              />
            </CollapsibleContent>
          </Collapsible>
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
