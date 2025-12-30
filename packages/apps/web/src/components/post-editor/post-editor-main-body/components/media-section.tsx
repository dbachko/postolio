import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import { CheckSwitch } from '@/components/ui/check-switch';
import { MultiImageUploader } from '@/components/multi-image-uploader';
import type { AssetReference } from '@/components/multi-image-uploader/types';
import { ChooseFromAssetsButton } from '@/components/choose-from-assets-button';
import { VideoUploader } from '@/components/video-uploader';
import type { InstagramContentType } from '@postolio/content-validation';

interface MediaSectionProps {
  mode: 'create' | 'edit';
  contentType: InstagramContentType;
  disabled: boolean;
  allowMixedMedia: boolean;
  brandId: string;
  carouselAssets: AssetReference[];
  shareToFeed: boolean;
  onCarouselAssetsChange: (assets: AssetReference[]) => void;
  onShareToFeedChange: (checked: boolean) => void;
  onOpenAssetPicker: () => void;
}

export function MediaSection({
  mode,
  contentType,
  disabled,
  allowMixedMedia,
  brandId,
  carouselAssets,
  shareToFeed,
  onCarouselAssetsChange,
  onShareToFeedChange,
  onOpenAssetPicker,
}: MediaSectionProps) {
  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-2">
        <Upload className="h-4 w-4" />
        Media <span className="text-destructive">*</span>
      </Label>

      {contentType === 'reel' ? (
        <div className="space-y-3">
          {disabled ? (
            <MultiImageUploader
              value={carouselAssets}
              onChange={() => {}}
              brandId={brandId}
              enableUpload={false}
            />
          ) : (
            <>
              <VideoUploader
                value={carouselAssets.find((asset) => asset.type === 'video')?.url}
                onChange={(url, meta) => {
                  const assetId = meta?.assetId;
                  if (url && !assetId) {
                    toast.error('Video upload missing asset ID. Please try again.');
                    return;
                  }
                  onCarouselAssetsChange(
                    url && assetId ? [{ id: assetId, url, type: 'video' }] : []
                  );
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
            </>
          )}

          <div className="border-border bg-muted/40 flex items-center justify-between rounded-md border px-3 py-2">
            <div className="space-y-0.5">
              <Label
                htmlFor={mode === 'create' ? 'share-to-feed-toggle' : 'share-to-feed-toggle-edit'}
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
              checked={shareToFeed}
              onCheckedChange={onShareToFeedChange}
              disabled={disabled}
            />
          </div>
        </div>
      ) : (
        <MultiImageUploader
          value={carouselAssets}
          onChange={onCarouselAssetsChange}
          brandId={brandId}
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
  );
}
