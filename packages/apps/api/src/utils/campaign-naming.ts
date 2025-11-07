/**
 * Campaign Naming Utility
 *
 * Auto-generates campaign names following the format:
 * {CampaignType}_{Theme}_{MonthYear}
 *
 * Examples:
 * - Promotional_Halloween_Oct2025
 * - Educational_TipsTutorials_Feb2025
 * - Seasonal_Campaign_Dec2025
 */

export interface CampaignNamingParams {
  campaignType: string;
  themes: string[];
  startDate: string;
  timezone?: string; // Optional timezone for accurate date formatting (defaults to UTC)
}

/**
 * Generates a campaign name using the format: {Type}_{Theme}_{MonthYear}
 *
 * @param campaignType - Type of campaign (promotional, educational, etc.)
 * @param themes - Array of theme strings (first theme will be used)
 * @param startDate - ISO date string for campaign start
 * @returns Auto-generated campaign name
 *
 * @example
 * generateCampaignName({
 *   campaignType: 'promotional',
 *   themes: ['halloween', 'spooky'],
 *   startDate: '2025-10-15'
 * })
 * // Returns: "Promotional_Halloween_Oct2025"
 */
/**
 * Helper function to extract and format theme name
 */
function formatThemeName(themes: string[]): string {
  let theme = 'Campaign';
  if (themes.length > 0 && themes[0].trim().length > 0) {
    theme = themes[0]
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 20);

    // Fallback if theme becomes empty after sanitization
    if (theme.length === 0) {
      theme = 'Campaign';
    }
  }
  return theme;
}

export function generateCampaignName({
  campaignType,
  themes,
  startDate,
  timezone = 'UTC',
}: CampaignNamingParams): string {
  // Parse date with validation
  const date = new Date(startDate);

  // Validate date is valid
  if (isNaN(date.getTime())) {
    // Fallback to current date if invalid
    console.warn(
      `Invalid date provided to generateCampaignName: "${startDate}". Using current date as fallback.`
    );
    const fallback = new Date();
    const month = fallback.toLocaleDateString('en-US', {
      month: 'short',
      timeZone: timezone,
    });
    const year = fallback.toLocaleDateString('en-US', { year: 'numeric', timeZone: timezone });
    const type = campaignType.charAt(0).toUpperCase() + campaignType.slice(1);
    const theme = formatThemeName(themes);
    return `${type}_${theme}_${month}${year}`;
  }

  // Format date in the specified timezone to get correct month/year
  const month = date.toLocaleDateString('en-US', { month: 'short', timeZone: timezone });
  const year = date.toLocaleDateString('en-US', { year: 'numeric', timeZone: timezone });
  const type = campaignType.charAt(0).toUpperCase() + campaignType.slice(1);
  const theme = formatThemeName(themes);

  return `${type}_${theme}_${month}${year}`;
}
