export type MaybeHashtagArray = (string | undefined | null)[] | undefined | null;

/**
 * Normalize hashtags before sending to the backend.
 * - Removes any leading '#' characters
 * - Drops non-string entries
 * - Filters out empty values
 */
export const normalizeHashtags = (tags: MaybeHashtagArray): string[] =>
  (tags || [])
    .map((tag) => (typeof tag === 'string' ? tag.replace(/^#+/, '').trim() : ''))
    .filter((tag) => tag.length > 0);

/**
 * Prepare hashtags for editing inputs (no leading '#', but preserve empty slots).
 */
export const stripHashtagPrefixes = (tags: MaybeHashtagArray): string[] =>
  (tags || []).map((tag) => {
    if (typeof tag !== 'string') return '';
    const withoutHash = tag.replace(/^#+/, '');
    return withoutHash;
  });
