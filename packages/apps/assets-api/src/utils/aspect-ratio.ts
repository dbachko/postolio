/**
 * Aspect ratio utility functions
 * Calculates aspect ratios for images and videos to enable filtering by social media formats
 */

export interface AspectRatioData {
  aspectRatio: string; // "1:1", "4:5", "9:16", "16:9", "CUSTOM"
  aspectRatioDecimal: number; // Decimal representation
  orientationType: 'portrait' | 'landscape' | 'square';
}

/**
 * Tolerance for matching aspect ratios to standard values
 * 3% tolerance allows for minor variations in source dimensions
 */
const ASPECT_RATIO_TOLERANCE = 0.03;

/**
 * Tolerance for determining if an aspect ratio is square
 * 1% tolerance around 1.0 ratio
 */
const SQUARE_ORIENTATION_TOLERANCE = 0.01;

/**
 * Standard aspect ratios with tolerance matching
 * Ordered by priority for matching
 */
const STANDARD_RATIOS = [
  { label: '1:1', decimal: 1.0, description: 'Square' },
  { label: '4:5', decimal: 0.8, description: 'Portrait' },
  { label: '9:16', decimal: 0.5625, description: 'Full vertical' },
  { label: '3:4', decimal: 0.75, description: 'Tall classic' },
  { label: '4:3', decimal: 1.3333, description: 'Photo classic' },
  { label: '16:9', decimal: 1.7778, description: 'Standard landscape' },
  { label: '1.91:1', decimal: 1.91, description: 'Social ads landscape' },
  { label: '2:1', decimal: 2.0, description: 'Ultra-wide' },
  { label: '2.39:1', decimal: 2.39, description: 'Cinematic wide' },
] as const;

/**
 * Calculate aspect ratio from width and height
 * Matches to standard ratios within tolerance
 *
 * @param width - Image or video width in pixels
 * @param height - Image or video height in pixels
 * @returns AspectRatioData with ratio, decimal, and orientation
 */
export function calculateAspectRatio(width: number, height: number): AspectRatioData {
  if (!width || !height || width <= 0 || height <= 0) {
    throw new Error('Invalid dimensions for aspect ratio calculation');
  }

  const decimal = width / height;

  // Try to match to a standard ratio
  for (const standard of STANDARD_RATIOS) {
    if (Math.abs(decimal - standard.decimal) <= ASPECT_RATIO_TOLERANCE) {
      return {
        aspectRatio: standard.label,
        aspectRatioDecimal: decimal,
        orientationType: getOrientation(decimal),
      };
    }
  }

  // No match found - return custom ratio
  return {
    aspectRatio: 'CUSTOM',
    aspectRatioDecimal: decimal,
    orientationType: getOrientation(decimal),
  };
}

/**
 * Get orientation type from aspect ratio decimal
 */
function getOrientation(ratio: number): 'portrait' | 'landscape' | 'square' {
  if (Math.abs(ratio - 1.0) < SQUARE_ORIENTATION_TOLERANCE) {
    return 'square';
  }

  return ratio < 1 ? 'portrait' : 'landscape';
}

/**
 * Check if an aspect ratio matches a common social media format
 * Useful for categorization and filtering
 */
export function matchesSocialMediaFormat(aspectRatio: string): boolean {
  const commonRatios = ['1:1', '4:5', '9:16', '16:9', '5:4', '3:4', '4:3'];
  return commonRatios.includes(aspectRatio);
}

/**
 * Get all standard aspect ratios
 * Useful for displaying filter options in the frontend
 */
export function getStandardRatios() {
  return STANDARD_RATIOS.map((ratio) => ({
    label: ratio.label,
    description: ratio.description,
    decimal: ratio.decimal,
  }));
}

/**
 * Get platform recommendations for an aspect ratio
 */
export function getPlatformRecommendations(aspectRatio: string): string[] {
  const platforms: Record<string, string[]> = {
    '1:1': ['Instagram Post', 'Facebook Post'],
    '4:5': ['Instagram Feed', 'Instagram Portrait'],
    '9:16': ['Instagram Stories', 'Instagram Reels', 'TikTok', 'YouTube Shorts'],
    '3:4': ['Pinterest', 'Traditional Portrait'],
    '4:3': ['Traditional Photo', 'Classic Video'],
    '16:9': ['YouTube', 'Twitter/X', 'LinkedIn', 'Facebook Video'],
    '1.91:1': ['Facebook Ads', 'Instagram Ads'],
    '2:1': ['Ultra-wide displays'],
    '2.39:1': ['Cinematic films', 'Widescreen video'],
  };

  return platforms[aspectRatio] || [];
}
