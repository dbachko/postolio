export type MediaKind = 'image-only' | 'video-only';

/**
 * Lightweight validator to ensure a set of files matches the expected media kind.
 * Returns a human-readable error string when invalid, otherwise null.
 */
export function validateMediaKind(
  files: FileList | File[] | null | undefined,
  kind: MediaKind
): string | null {
  if (!files || (Array.isArray(files) && files.length === 0)) return null;

  const arr = Array.from(files as any as File[]);
  const hasImage = arr.some((f) => f.type.startsWith('image/'));
  const hasVideo = arr.some((f) => f.type.startsWith('video/'));

  if (kind === 'image-only') {
    if (hasVideo) {
      return 'This uploader only accepts image files. Remove any video files and try again.';
    }
    if (!hasImage) {
      return 'Please upload at least one image file.';
    }
  }

  if (kind === 'video-only') {
    if (hasImage) {
      return 'This uploader only accepts video files. Remove any image files and try again.';
    }
    if (!hasVideo) {
      return 'Please upload a video file.';
    }
  }

  return null;
}
