/**
 * Frontend Timezone Constants
 * Shared timezone configuration for consistent defaults across the frontend
 */

/**
 * Default timezone used when no user preference is available
 * UTC is chosen as a neutral global default that works for all users
 */
export const DEFAULT_TIMEZONE = 'UTC'

/**
 * Timezone used when browser detection fails
 * UTC ensures the application works even with limited browser support
 */
export const BROWSER_DETECTION_FALLBACK = 'UTC'

/**
 * Default timezone for new brands when no specific timezone is set
 */
export const BRAND_TIMEZONE_FALLBACK = 'UTC'

/**
 * Validate if a timezone string is supported by the browser
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    // Test if the timezone is valid by trying to format a date with it
    Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date())
    return true
  } catch {
    return false
  }
}