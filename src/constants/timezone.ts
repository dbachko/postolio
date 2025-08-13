/**
 * Timezone Constants
 * Centralized timezone configuration for consistent defaults across the application
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
 * Inherits from user preference, with UTC as ultimate fallback
 */
export const BRAND_TIMEZONE_FALLBACK = 'UTC'

/**
 * List of common timezone identifiers for validation
 * This is a subset - full validation should use Intl.supportedValuesOf('timeZone')
 */
export const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago', 
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
  'America/Toronto',
  'America/Vancouver',
] as const

/**
 * Validate if a timezone string is supported by the runtime
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