import type { InstagramContentType } from '@postolio/content-validation';
import type { Platform } from '@/lib/platform-config';

export type PreviewMedia = {
  url: string;
  type: 'image' | 'video';
  thumbnailUrl?: string | null;
};

export type PostPreviewContent = {
  caption: string;
  contentType: InstagramContentType;
  shareToFeed?: boolean | null;
  firstComment?: string | null;
  media: PreviewMedia[];
};

export type PostPreviewAccount = {
  id: string;
  platform: Platform;
  label: string;
  avatarName: string;
  avatarUrl: string | null;
  disconnected?: boolean;
};

export type PostPreviewItem = {
  account: PostPreviewAccount;
  content: PostPreviewContent;
  note?: string;
};
