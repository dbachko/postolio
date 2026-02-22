/**
 * Extract hashtags from a caption string.
 * - Finds words starting with '#'
 * - Strips leading '#' characters
 * - Lowercases and de-duplicates
 */
export function extractHashtagsFromCaption(caption: string | null | undefined): string[] {
  if (!caption) {
    return [];
  }

  const matches = caption.match(/#([^\s#]+)/g) || [];
  const tags = matches
    .map((raw) => raw.replace(/^#+/, '').trim().toLowerCase())
    .filter((tag) => tag.length > 0);

  return Array.from(new Set(tags));
}
