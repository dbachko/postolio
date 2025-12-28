import { formatInTimeZone } from 'date-fns-tz';

/**
 * Formats a timestamp to display time in the given timezone.
 * Returns empty string if timestamp is invalid.
 */
export function formatDisplayTime(timestamp: string | null | undefined, timezone: string): string {
  if (!timestamp) return '';
  try {
    return formatInTimeZone(new Date(timestamp), timezone, 'h:mm a');
  } catch {
    return '';
  }
}

/**
 * Formats a timestamp to full date/time in the given timezone.
 * Returns empty string if timestamp is invalid.
 */
export function formatFullDateTime(timestamp: string | null | undefined, timezone: string): string {
  if (!timestamp) return '';
  try {
    return formatInTimeZone(new Date(timestamp), timezone, 'MMM d, yyyy h:mm a');
  } catch {
    return '';
  }
}
