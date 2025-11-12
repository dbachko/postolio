/**
 * Date formatting utilities for the application
 */

/**
 * Formats a date string to a human-readable format
 * @param dateString - ISO date string or null/undefined
 * @param options - Intl.DateTimeFormat options (defaults to short month, day, and year)
 * @returns Formatted date string or '—' if input is null/undefined
 *
 * @example
 * formatDate('2025-01-15T10:00:00Z') // "Jan 15, 2025"
 * formatDate(null) // "—"
 * formatDate('2025-01-15', { month: 'long', day: 'numeric' }) // "January 15"
 */
export function formatDate(
  dateString?: string | null,
  options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }
): string {
  if (!dateString) return '—';

  try {
    const date = new Date(dateString);

    // Check if date is valid
    if (isNaN(date.getTime())) {
      console.error(`Invalid date string: ${dateString}`);
      return '—';
    }

    return date.toLocaleDateString('en-US', options);
  } catch (error) {
    console.error(`Error formatting date: ${dateString}`, error);
    return '—';
  }
}

/**
 * Formats a date string to time only (e.g., "2:30 PM")
 * @param dateString - ISO date string or null/undefined
 * @returns Formatted time string or '—' if input is null/undefined
 *
 * @example
 * formatTime('2025-01-15T14:30:00Z') // "2:30 PM"
 * formatTime(null) // "—"
 */
export function formatTime(dateString?: string | null): string {
  if (!dateString) return '—';

  try {
    const date = new Date(dateString);

    if (isNaN(date.getTime())) {
      console.error(`Invalid date string: ${dateString}`);
      return '—';
    }

    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch (error) {
    console.error(`Error formatting time: ${dateString}`, error);
    return '—';
  }
}

/**
 * Formats a date string to date and time (e.g., "Jan 15, 2025 at 2:30 PM")
 * @param dateString - ISO date string or null/undefined
 * @returns Formatted date and time string or '—' if input is null/undefined
 *
 * @example
 * formatDateTime('2025-01-15T14:30:00Z') // "Jan 15, 2025 at 2:30 PM"
 */
export function formatDateTime(dateString?: string | null): string {
  if (!dateString) return '—';

  const datePart = formatDate(dateString);
  const timePart = formatTime(dateString);

  if (datePart === '—' || timePart === '—') return '—';

  return `${datePart} at ${timePart}`;
}

/**
 * Formats a date to relative time (e.g., "2 hours ago", "in 3 days")
 * @param dateString - ISO date string or null/undefined
 * @returns Relative time string or '—' if input is null/undefined
 *
 * @example
 * formatRelativeTime('2025-01-15T10:00:00Z') // "2 hours ago"
 */
export function formatRelativeTime(dateString?: string | null): string {
  if (!dateString) return '—';

  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '—';

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(Math.abs(diffMs) / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    const diffWeek = Math.floor(diffDay / 7);
    const diffMonth = Math.floor(diffDay / 30);
    const diffYear = Math.floor(diffDay / 365);

    const past = diffMs > 0;
    const suffix = past ? 'ago' : 'from now';

    if (diffSec < 60) return `just now`;
    if (diffMin < 60) return `${diffMin} ${diffMin === 1 ? 'minute' : 'minutes'} ${suffix}`;
    if (diffHour < 24) return `${diffHour} ${diffHour === 1 ? 'hour' : 'hours'} ${suffix}`;
    if (diffDay < 7) return `${diffDay} ${diffDay === 1 ? 'day' : 'days'} ${suffix}`;
    if (diffWeek < 4) return `${diffWeek} ${diffWeek === 1 ? 'week' : 'weeks'} ${suffix}`;
    if (diffMonth < 12) return `${diffMonth} ${diffMonth === 1 ? 'month' : 'months'} ${suffix}`;
    return `${diffYear} ${diffYear === 1 ? 'year' : 'years'} ${suffix}`;
  } catch (error) {
    console.error(`Error formatting relative time: ${dateString}`, error);
    return '—';
  }
}
