import type { InstagramContentType } from '@postolio/content-validation';
import type { Platform } from '@/lib/platform-config';

import type { AssetReference } from '@/components/multi-image-uploader/types';

export type ContentGroupTemplateFormState = {
  caption: string;
  carouselAssets: AssetReference[];
  contentType: InstagramContentType;
  shareToFeed: boolean;
  firstComment: string;
};

export interface ContentGroupTemplateEditorProps {
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
