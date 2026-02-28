import { Upload } from 'lucide-react';
import { toast } from 'sonner';

import { ChooseFromAssetsButton } from '@/components/choose-from-assets-button';
import { MultiImageUploader } from '@/components/multi-image-uploader';
import { VideoUploader } from '@/components/video-uploader';
import { CheckSwitch } from '@/components/ui/check-switch';
import { Label } from '@/components/ui/label';

import type { ContentGroupTemplateFormState } from '../types';

interface TemplateMediaSectionProps {
  brandId: string;
  value: ContentGroupTemplateFormState;
  allowMixedMedia: boolean;
  onChange: (
    updater: (prev: ContentGroupTemplateFormState) => ContentGroupTemplateFormState
  ) => void;
  onOpenAssetPicker: () => void;
}

function ReelMediaUploader(props: Omit<TemplateMediaSectionProps, 'allowMixedMedia'>) {
  return (
    <div className="space-y-3">
      <VideoUploader
        value={props.value.carouselAssets.find((asset) => asset.type === 'video')?.url || ''}
        onChange={(url, meta) => {
          const assetId = meta?.assetId;
          if (url && !assetId) {
            toast.error('Video upload missing asset ID. Please try again.');
            return;
          }

          props.onChange((state) => ({
            ...state,
            carouselAssets: url && assetId ? [{ id: assetId, url, type: 'video' }] : [],
          }));
        }}
        brandId={props.brandId}
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
      <ChooseFromAssetsButton onClick={props.onOpenAssetPicker} />
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
          checked={props.value.shareToFeed}
          onCheckedChange={(checked) =>
            props.onChange((state) => ({ ...state, shareToFeed: checked }))
          }
        />
      </div>
    </div>
  );
}

export function TemplateMediaSection(props: TemplateMediaSectionProps) {
  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-2">
        <Upload className="h-4 w-4" />
        Media <span className="text-destructive">*</span>
      </Label>

      {props.value.contentType === 'reel' ? (
        <ReelMediaUploader
          brandId={props.brandId}
          value={props.value}
          onChange={props.onChange}
          onOpenAssetPicker={props.onOpenAssetPicker}
        />
      ) : (
        <MultiImageUploader
          value={props.value.carouselAssets}
          onChange={(assets) => props.onChange((state) => ({ ...state, carouselAssets: assets }))}
          brandId={props.brandId}
          maxImages={10}
          maxSizeInMB={10}
          maxVideoSizeInMB={300}
          acceptedVideoFormats={['video/mp4', 'video/quicktime', 'video/mpeg']}
          allowMixedMedia={props.allowMixedMedia}
          onChooseFromAssets={props.onOpenAssetPicker}
        />
      )}
    </div>
  );
}
