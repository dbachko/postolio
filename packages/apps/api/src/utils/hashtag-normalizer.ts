/**
 * Normalize hashtags by stripping # symbols
 * This ensures consistency across manual and AI-generated content
 *
 * @param hashtags - Array of hashtag strings (may or may not include # prefix)
 * @returns Normalized array of hashtags without # symbols
 *
 * @example
 * normalizeHashtags(['#travel', 'lifestyle', '##multiple'])
 * // Returns: ['travel', 'lifestyle', 'multiple']
 */
export function normalizeHashtags(hashtags: string[]): string[] {
  return hashtags.map((tag) => tag.replace(/^#+/, '').trim()).filter((tag) => tag.length > 0);
}
