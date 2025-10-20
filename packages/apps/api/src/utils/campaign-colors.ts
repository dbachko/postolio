/**
 * Campaign Color Management Utility
 *
 * Provides a visually distinct color palette for campaign identification
 * in calendar and timeline views. Uses high-contrast, accessible colors
 * that work well against both light and dark backgrounds.
 */

/**
 * Predefined color palette for campaign color coding
 * Colors selected for:
 * - Visual distinction (easy to tell apart at a glance)
 * - WCAG AA accessibility compliance
 * - Balance between vibrant and professional
 */
export const CAMPAIGN_COLOR_PALETTE = [
  '#3b82f6', // Blue
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#8b5cf6', // Purple
  '#06b6d4', // Cyan
  '#f97316', // Orange
  '#14b8a6', // Teal
  '#6366f1', // Indigo
  '#84cc16', // Lime
  '#ef4444', // Red
  '#a855f7', // Violet
  '#22c55e', // Green
  '#eab308', // Yellow
  '#0ea5e9', // Sky
  '#d946ef', // Fuchsia
] as const;

/**
 * Map of Tailwind color names to hex codes
 * Useful for storing as hex in DB but using Tailwind classes in frontend
 */
export const COLOR_TO_TAILWIND_MAP: Record<
  string,
  { bg: string; text: string; border: string; hover: string }
> = {
  '#3b82f6': {
    bg: 'bg-blue-500',
    text: 'text-blue-700',
    border: 'border-blue-500',
    hover: 'hover:bg-blue-600',
  },
  '#10b981': {
    bg: 'bg-emerald-500',
    text: 'text-emerald-700',
    border: 'border-emerald-500',
    hover: 'hover:bg-emerald-600',
  },
  '#f59e0b': {
    bg: 'bg-amber-500',
    text: 'text-amber-700',
    border: 'border-amber-500',
    hover: 'hover:bg-amber-600',
  },
  '#ec4899': {
    bg: 'bg-pink-500',
    text: 'text-pink-700',
    border: 'border-pink-500',
    hover: 'hover:bg-pink-600',
  },
  '#8b5cf6': {
    bg: 'bg-purple-500',
    text: 'text-purple-700',
    border: 'border-purple-500',
    hover: 'hover:bg-purple-600',
  },
  '#06b6d4': {
    bg: 'bg-cyan-500',
    text: 'text-cyan-700',
    border: 'border-cyan-500',
    hover: 'hover:bg-cyan-600',
  },
  '#f97316': {
    bg: 'bg-orange-500',
    text: 'text-orange-700',
    border: 'border-orange-500',
    hover: 'hover:bg-orange-600',
  },
  '#14b8a6': {
    bg: 'bg-teal-500',
    text: 'text-teal-700',
    border: 'border-teal-500',
    hover: 'hover:bg-teal-600',
  },
  '#6366f1': {
    bg: 'bg-indigo-500',
    text: 'text-indigo-700',
    border: 'border-indigo-500',
    hover: 'hover:bg-indigo-600',
  },
  '#84cc16': {
    bg: 'bg-lime-500',
    text: 'text-lime-700',
    border: 'border-lime-500',
    hover: 'hover:bg-lime-600',
  },
  '#ef4444': {
    bg: 'bg-red-500',
    text: 'text-red-700',
    border: 'border-red-500',
    hover: 'hover:bg-red-600',
  },
  '#a855f7': {
    bg: 'bg-violet-500',
    text: 'text-violet-700',
    border: 'border-violet-500',
    hover: 'hover:bg-violet-600',
  },
  '#22c55e': {
    bg: 'bg-green-500',
    text: 'text-green-700',
    border: 'border-green-500',
    hover: 'hover:bg-green-600',
  },
  '#eab308': {
    bg: 'bg-yellow-500',
    text: 'text-yellow-700',
    border: 'border-yellow-500',
    hover: 'hover:bg-yellow-600',
  },
  '#0ea5e9': {
    bg: 'bg-sky-500',
    text: 'text-sky-700',
    border: 'border-sky-500',
    hover: 'hover:bg-sky-600',
  },
  '#d946ef': {
    bg: 'bg-fuchsia-500',
    text: 'text-fuchsia-700',
    border: 'border-fuchsia-500',
    hover: 'hover:bg-fuchsia-600',
  },
};

/**
 * Assigns a color to a campaign based on existing brand campaigns
 * Distributes colors evenly to minimize visual confusion
 *
 * @param existingColors - Array of colors already assigned to other campaigns in the brand
 * @returns A hex color code from the palette
 */
export function assignCampaignColor(existingColors: (string | null)[]): string {
  // Filter out null values and get actual colors
  const usedColors = existingColors.filter(Boolean) as string[];

  // If no colors used yet, return the first color
  if (usedColors.length === 0) {
    return CAMPAIGN_COLOR_PALETTE[0];
  }

  // Find first unused color in palette
  const unusedColor = CAMPAIGN_COLOR_PALETTE.find((color) => !usedColors.includes(color));

  if (unusedColor) {
    return unusedColor;
  }

  // All colors used - start cycling through palette again
  // Use modulo to distribute evenly
  return CAMPAIGN_COLOR_PALETTE[usedColors.length % CAMPAIGN_COLOR_PALETTE.length];
}

/**
 * Validates if a color is a valid hex code
 *
 * @param color - Color string to validate
 * @returns true if valid hex code, false otherwise
 */
export function isValidHexColor(color: string): boolean {
  return /^#([0-9A-F]{3}){1,2}$/i.test(color);
}

/**
 * Gets the next available color for a brand based on existing campaigns
 *
 * @param existingColors - Colors already used by campaigns in this brand
 * @returns Next available color hex code
 */
export function getNextAvailableColor(existingColors: string[]): string {
  // Find first color not in use
  for (const color of CAMPAIGN_COLOR_PALETTE) {
    if (!existingColors.includes(color)) {
      return color;
    }
  }

  // All colors in use, cycle back to start
  return CAMPAIGN_COLOR_PALETTE[existingColors.length % CAMPAIGN_COLOR_PALETTE.length];
}

/**
 * Converts a hex color to RGB values
 *
 * @param hex - Hex color code (e.g., '#3b82f6')
 * @returns RGB object with r, g, b values (0-255)
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

/**
 * Gets a lighter shade of a color for backgrounds
 *
 * @param hex - Hex color code
 * @param opacity - Opacity percentage (0-100)
 * @returns RGBA string for use in CSS
 */
export function getColorWithOpacity(hex: string, opacity: number = 10): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(59, 130, 246, ${opacity / 100})`; // Fallback to blue

  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity / 100})`;
}

/**
 * Gets a color name for display purposes
 *
 * @param hex - Hex color code
 * @returns Human-readable color name
 */
export function getColorName(hex: string): string {
  const colorNames: Record<string, string> = {
    '#3b82f6': 'Blue',
    '#10b981': 'Emerald',
    '#f59e0b': 'Amber',
    '#ec4899': 'Pink',
    '#8b5cf6': 'Purple',
    '#06b6d4': 'Cyan',
    '#f97316': 'Orange',
    '#14b8a6': 'Teal',
    '#6366f1': 'Indigo',
    '#84cc16': 'Lime',
    '#ef4444': 'Red',
    '#a855f7': 'Violet',
    '#22c55e': 'Green',
    '#eab308': 'Yellow',
    '#0ea5e9': 'Sky',
    '#d946ef': 'Fuchsia',
  };

  return colorNames[hex] || 'Unknown';
}
