import type { InstagramContentType } from '@postolio/content-validation';

import type { AssetReference } from '@/components/multi-image-uploader/types';

export type ContentGroupTemplateFormState = {
  caption: string;
  carouselAssets: AssetReference[];
  contentType: InstagramContentType;
  shareToFeed: boolean;
  firstComment: string;
};
