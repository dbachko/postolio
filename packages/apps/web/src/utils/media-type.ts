export type MediaBadgeType = 'image' | 'video' | 'reel' | 'carousel' | 'text';

export function getMediaBadgeType(input: {
  contentType?: string | null;
  mediaAssets?: Array<unknown> | null;
  primaryAssetFileType?: 'image' | 'video' | null;
  mediaAssetCount?: number | null;
}): MediaBadgeType {
  const assetCount =
    typeof input.mediaAssetCount === 'number'
      ? input.mediaAssetCount
      : Array.isArray(input.mediaAssets)
        ? input.mediaAssets.length
        : 0;

  if (input.contentType === 'reel') return 'reel';
  if (assetCount > 1) return 'carousel';
  if (input.primaryAssetFileType === 'video') return 'video';
  if (input.primaryAssetFileType === 'image' || assetCount === 1) return 'image';
  return 'text';
}
