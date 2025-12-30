import { getPlatformConfig, type Platform } from '@/lib/platform-config';
import type { SocialAccountsPickerOption } from '@/components/social/social-accounts-picker/types';
import type { AssetReference } from '@/components/multi-image-uploader/types';
import type { InstagramContentType } from '@postolio/content-validation';

export function getMediaSummary(assets: AssetReference[]) {
  const images = assets.filter((asset) => asset.type === 'image').length;
  const videos = assets.filter((asset) => asset.type === 'video').length;

  return {
    total: assets.length,
    images,
    videos,
    hasImages: images > 0,
    hasVideos: videos > 0,
  };
}

export function getSelectedPlatforms(params: {
  platformOptions?: SocialAccountsPickerOption[];
  selectedPlatformAccountIds?: string[];
}): Platform[] {
  const { platformOptions, selectedPlatformAccountIds } = params;
  if (!platformOptions || !selectedPlatformAccountIds) return [];

  const byId = new Map(platformOptions.map((opt) => [opt.id, opt.platform]));
  const out = new Set<Platform>();

  for (const id of selectedPlatformAccountIds) {
    const platform = byId.get(id);
    if (platform) out.add(platform);
  }

  return Array.from(out);
}

export function getAllowedContentTypes(selectedPlatforms: Platform[]) {
  if (selectedPlatforms.length === 0) {
    return { post: false, reel: false, story: false };
  }
  const post = selectedPlatforms.every((p) => getPlatformConfig(p).features.publishing);
  const reel = selectedPlatforms.every((p) => getPlatformConfig(p).features.reels);
  const story = selectedPlatforms.every((p) => getPlatformConfig(p).features.stories);
  return { post, reel, story };
}

export function getContentTypeDisabledReasons(params: {
  allowedContentTypes: { post: boolean; reel: boolean; story: boolean };
  mediaSummary: ReturnType<typeof getMediaSummary>;
}): Record<InstagramContentType, string | null> {
  const { allowedContentTypes, mediaSummary } = params;

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
}

export function findFirstEnabledContentType(
  disabledReasons: Record<InstagramContentType, string | null>
): InstagramContentType | null {
  if (!disabledReasons.post) return 'post';
  if (!disabledReasons.reel) return 'reel';
  if (!disabledReasons.story) return 'story';
  return null;
}
