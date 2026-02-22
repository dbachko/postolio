export type MediaBadgeType = 'image' | 'video' | 'reel' | 'carousel' | 'text';

export function getMediaBadgeType(input: {
  contentType?: string | null;
  mediaAssets?: unknown[] | null;
  primaryAssetFileType?: 'image' | 'video' | null;
  mediaAssetCount?: number | null;
}): MediaBadgeType {
  let assetCount = 0;
  if (typeof input.mediaAssetCount === 'number') {
    assetCount = input.mediaAssetCount;
  } else if (Array.isArray(input.mediaAssets)) {
    assetCount = input.mediaAssets.length;
  }

  if (input.contentType === 'reel') {
    return 'reel';
  }
  if (assetCount > 1) {
    return 'carousel';
  }
  if (input.primaryAssetFileType === 'video') {
    return 'video';
  }
  if (input.primaryAssetFileType === 'image' || assetCount === 1) {
    return 'image';
  }
  return 'text';
}
