import { toast } from 'sonner';

import type { InstagramContentType } from '@postolio/content-validation';
import type { ContentGroupTemplateFormState } from '@/components/post-editor/content-group-template-editor/types';

export function destinationErrorMessage(error: any, fallback: string): string {
  if (typeof error?.data?.message === 'string') {
    return error.data.message;
  }
  if (typeof error?.data?.error === 'string') {
    return error.data.error;
  }
  if (typeof error?.message === 'string') {
    return error.message;
  }
  return fallback;
}

export function notifyDestinationSchedulingFailure(response: any): void {
  const results = Array.isArray(response?.scheduling?.results) ? response.scheduling.results : [];
  const failed = results.find((value: any) => value?.ok === false);
  if (!failed) {
    return;
  }
  let message = 'Scheduling failed for the new destination.';
  if (typeof failed?.error?.message === 'string') {
    message = failed.error.message;
  } else if (typeof failed?.error?.error === 'string') {
    message = failed.error.error;
  }
  toast.error(message);
}

export function createdDestinationContentId(
  response: any,
  targetSocialAccountId: string
): string | null {
  const added = Array.isArray(response?.added) ? response.added : [];
  return (
    added.find((entry: any) => entry?.targetSocialAccountId === targetSocialAccountId)?.contentId ||
    added[0]?.contentId ||
    null
  );
}

export function buildDestinationTemplatePayload(
  templateFormData: ContentGroupTemplateFormState,
  templateFirstCommentOpen: boolean
): {
  caption: string;
  contentType: InstagramContentType;
  shareToFeed: boolean | null;
  firstComment: string | null;
  assetIds: string[];
} {
  const isStory = templateFormData.contentType === 'story';
  const caption = isStory ? '' : (templateFormData.caption || '').trim();
  let firstComment: string | null = null;
  if (!isStory && templateFirstCommentOpen && templateFormData.firstComment?.trim()) {
    firstComment = templateFormData.firstComment.trim();
  }
  const shareToFeed = templateFormData.contentType === 'reel' ? templateFormData.shareToFeed : null;
  const assetIds = (templateFormData.carouselAssets || [])
    .map((asset) => asset.id)
    .filter(
      (assetId): assetId is string => typeof assetId === 'string' && assetId.trim().length > 0
    )
    .map((assetId) => assetId.trim());

  return {
    caption,
    contentType: templateFormData.contentType,
    shareToFeed,
    firstComment,
    assetIds,
  };
}
