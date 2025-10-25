/**
 * Campaign Color Utilities - Frontend
 *
 * Provides color styling utilities for campaign visual identification
 * in calendar and timeline views.
 */

/**
 * Converts a hex color to an RGBA string with opacity
 *
 * @param hex - Hex color code (e.g., '#3b82f6')
 * @param opacity - Opacity value from 0-1
 * @returns RGBA string for use in CSS
 */
export function hexToRgba(hex: string | null | undefined, opacity: number = 0.1): string {
  if (!hex) {
    // Default to blue if no color provided
    return `rgba(59, 130, 246, ${opacity})`;
  }

  // Remove # if present
  const cleanHex = hex.replace('#', '');

  // Parse RGB values
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);

  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return `rgba(59, 130, 246, ${opacity})`;
  }

  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/**
 * Gets CSS classes for campaign color styling
 *
 * @param campaignColor - Hex color code or null
 * @returns Object with className and style properties
 */
export function getCampaignColorStyles(campaignColor: string | null | undefined): {
  backgroundColor?: string;
  borderColor?: string;
  color?: string;
} {
  if (!campaignColor) {
    return {};
  }

  return {
    backgroundColor: hexToRgba(campaignColor, 0.15),
    borderColor: campaignColor,
    color: campaignColor,
  };
}

/**
 * Gets border-left style for campaign color accent
 *
 * @param campaignColor - Hex color code or null
 * @param width - Border width in pixels (default: 4)
 * @returns CSS border-left property value
 */
export function getCampaignColorBorder(
  campaignColor: string | null | undefined,
  width: number = 4
): string {
  if (!campaignColor) {
    return `${width}px solid #cbd5e1`; // Default gray
  }

  return `${width}px solid ${campaignColor}`;
}

/**
 * Determines if a color is light or dark for text contrast
 *
 * @param hex - Hex color code
 * @returns true if color is light (needs dark text), false if dark (needs light text)
 */
export function isLightColor(hex: string | null | undefined): boolean {
  if (!hex) return true;

  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);

  // Calculate relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  return luminance > 0.5;
}

/**
 * Gets appropriate text color based on background color
 *
 * @param hex - Hex color code
 * @returns Text color (black or white)
 */
export function getContrastTextColor(hex: string | null | undefined): string {
  return isLightColor(hex) ? '#000000' : '#FFFFFF';
}

/**
 * Deterministically pick a color from a small palette based on an ID/string.
 * Useful when a campaign doesn't have an explicit color provided by the API.
 */
export function getStableColorFromId(id: string | undefined | null): string {
  // Hex palette (Tailwind 300-ish tones) for broad contrast and readability
  const palette = [
    '#93C5FD', // blue-300
    '#6EE7B7', // emerald-300
    '#FCD34D', // amber-300
    '#C4B5FD', // violet-300
    '#5EEAD4', // teal-300
    '#FCA5A5', // red-300
    '#A5B4FC', // indigo-300
    '#FDA4AF', // rose-300
    '#FDBA74', // orange-300
    '#F0ABFC', // fuchsia-300
    '#F9A8D4', // pink-300
  ];
  if (!id) return palette[0];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

/**
 * Creates inline styles for campaign color coding
 * Suitable for React component style props
 *
 * @param campaignColor - Hex color code or null
 * @param variant - Style variant: 'background' | 'border' | 'dot'
 * @returns CSS properties object
 */
export function getCampaignInlineStyles(
  campaignColor: string | null | undefined,
  variant: 'background' | 'border' | 'dot' = 'border'
): React.CSSProperties {
  if (!campaignColor) {
    return {};
  }

  switch (variant) {
    case 'background':
      return {
        backgroundColor: hexToRgba(campaignColor, 0.15),
        border: `1px solid ${campaignColor}`,
      };

    case 'border':
      return {
        borderLeft: `4px solid ${campaignColor}`,
      };

    case 'dot':
      return {
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: campaignColor,
      };

    default:
      return {};
  }
}
