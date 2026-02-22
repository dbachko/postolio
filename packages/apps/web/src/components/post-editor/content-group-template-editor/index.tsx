import { useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import {
  CircleFadingPlus,
  Film,
  Image as ImageIcon,
  MessageSquareText,
  Upload,
} from 'lucide-react';
import type { InstagramContentType } from '@postolio/content-validation';

import { ChooseFromAssetsButton } from '@/components/choose-from-assets-button';
import { MultiImageUploader } from '@/components/multi-image-uploader';
import { PostCaptionEditor } from '@/components/post-caption-editor';
import { VideoUploader } from '@/components/video-uploader';
import { CheckSwitch } from '@/components/ui/check-switch';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { getPlatformConfig, type Platform } from '@/lib/platform-config';

import type { ContentGroupTemplateFormState } from './types';

interface ContentGroupTemplateEditorProps {
  brandId: string;
  platforms: Platform[];
  value: ContentGroupTemplateFormState;
  onChange: (
    updater: (prev: ContentGroupTemplateFormState) => ContentGroupTemplateFormState
  ) => void;
  firstCommentOpen: boolean;
  onFirstCommentOpenChange: (open: boolean) => void;
  onOpenAssetPicker: () => void;
}

export function ContentGroupTemplateEditor({
  brandId,
  platforms,
  value,
  onChange,
  firstCommentOpen,
  onFirstCommentOpenChange,
  onOpenAssetPicker,
}: ContentGroupTemplateEditorProps) {
  const selectedPlatforms = useMemo(() => Array.from(new Set(platforms)), [platforms]);

  const allowedContentTypes = useMemo(() => {
    if (selectedPlatforms.length === 0) {
      return { post: true, reel: true, story: true };
    }
    const post = selectedPlatforms.every((p) => getPlatformConfig(p).features.publishing);
    const reel = selectedPlatforms.every((p) => getPlatformConfig(p).features.reels);
    const story = selectedPlatforms.every((p) => getPlatformConfig(p).features.stories);
    return { post, reel, story };
  }, [selectedPlatforms]);

  useEffect(() => {
    if (selectedPlatforms.length === 0) {
      return;
    }
    const current = value.contentType;
    let allowed = allowedContentTypes.story;
    if (current === 'post') {
      allowed = allowedContentTypes.post;
    } else if (current === 'reel') {
      allowed = allowedContentTypes.reel;
    }

    if (allowed) {
      return;
    }
    if (!allowedContentTypes.post) {
      return;
    }
    onChange((s) => ({ ...s, contentType: 'post' }));
  }, [allowedContentTypes, onChange, selectedPlatforms.length, value.contentType]);

  const allowMixedMedia = useMemo(() => {
    if (value.contentType !== 'post') {
      return false;
    }
    // Facebook feed posts cannot mix photos and videos.
    return selectedPlatforms.every((p) => p !== 'facebook');
  }, [selectedPlatforms, value.contentType]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-sm">
          Content Type <span className="text-destructive">*</span>
        </Label>
        <RadioGroup
          value={value.contentType}
          onValueChange={(next) =>
            onChange((s) => {
              const nextType = next as InstagramContentType;
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
              id="template-type-post"
              className="peer sr-only"
              disabled={!allowedContentTypes.post}
            />
            <Label
              htmlFor="template-type-post"
              className="hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-accent/50 border-input bg-background flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 text-xs transition-all peer-disabled:pointer-events-none peer-disabled:opacity-50 sm:text-sm"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              <span>Post</span>
            </Label>
          </div>
          <div className="flex-1">
            <RadioGroupItem
              value="reel"
              id="template-type-reel"
              className="peer sr-only"
              disabled={!allowedContentTypes.reel}
            />
            <Label
              htmlFor="template-type-reel"
              className="hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-accent/50 border-input bg-background flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 text-xs transition-all peer-disabled:pointer-events-none peer-disabled:opacity-50 sm:text-sm"
            >
              <Film className="h-3.5 w-3.5" />
              <span>Reel</span>
            </Label>
          </div>
          <div className="flex-1">
            <RadioGroupItem
              value="story"
              id="template-type-story"
              className="peer sr-only"
              disabled={!allowedContentTypes.story}
            />
            <Label
              htmlFor="template-type-story"
              className="hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-accent/50 border-input bg-background flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 text-xs transition-all peer-disabled:pointer-events-none peer-disabled:opacity-50 sm:text-sm"
            >
              <CircleFadingPlus className="h-3.5 w-3.5" />
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

        {value.contentType === 'reel' ? (
          <div className="space-y-3">
            <VideoUploader
              value={value.carouselAssets.find((asset) => asset.type === 'video')?.url || ''}
              onChange={(url, meta) => {
                const assetId = meta?.assetId;
                if (url && !assetId) {
                  toast.error('Video upload missing asset ID. Please try again.');
                  return;
                }
                onChange((s) => ({
                  ...s,
                  carouselAssets: url && assetId ? [{ id: assetId, url, type: 'video' }] : [],
                }));
              }}
              brandId={brandId}
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
                <Label htmlFor="template-share-to-feed-toggle" className="text-xs font-medium">
                  Share to Feed
                </Label>
                <p className="text-muted-foreground text-xs">
                  When enabled, this reel appears in both your feed grid and the Reels tab.
                </p>
              </div>
              <CheckSwitch
                id="template-share-to-feed-toggle"
                checked={value.shareToFeed}
                onCheckedChange={(checked) => onChange((s) => ({ ...s, shareToFeed: checked }))}
              />
            </div>
          </div>
        ) : (
          <MultiImageUploader
            value={value.carouselAssets}
            onChange={(assets) => onChange((s) => ({ ...s, carouselAssets: assets }))}
            brandId={brandId}
            maxImages={10}
            maxSizeInMB={10}
            maxVideoSizeInMB={300}
            acceptedVideoFormats={['video/mp4', 'video/quicktime', 'video/mpeg']}
            allowMixedMedia={allowMixedMedia}
            onChooseFromAssets={onOpenAssetPicker}
          />
        )}
      </div>

      {value.contentType !== 'story' ? (
        <>
          <PostCaptionEditor
            value={value.caption}
            onChange={(caption) => onChange((s) => ({ ...s, caption }))}
            brandId={brandId}
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
                id="template-first-comment-toggle"
                checked={firstCommentOpen}
                onCheckedChange={onFirstCommentOpenChange}
              />
            </div>
            {firstCommentOpen ? (
              <PostCaptionEditor
                id="template-firstComment"
                hideLabel={true}
                value={value.firstComment || ''}
                onChange={(firstComment) => onChange((s) => ({ ...s, firstComment }))}
                brandId={brandId}
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
    </div>
  );
}
