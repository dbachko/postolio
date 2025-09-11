import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import { parseISO } from 'date-fns';
import { BROWSER_DETECTION_FALLBACK } from '../constants/timezone';

// Session-based cache for timezone detection
let cachedUserTimezone: string | null = null;
let hasCheckedLocalStorage = false;

/**
 * Get user's timezone from browser (auto-detect) with session-based caching
 */
export const getUserTimezone = (): string => {
  // Return cached timezone if available (session-based)
  if (cachedUserTimezone) {
    return cachedUserTimezone;
  }

  // Check localStorage for persisted detected timezone (only once per session)
  if (!hasCheckedLocalStorage) {
    const storedTimezone = localStorage.getItem('detectedTimezone');
    hasCheckedLocalStorage = true;
    if (storedTimezone) {
      cachedUserTimezone = storedTimezone;
      return cachedUserTimezone;
    }
  }

  try {
    cachedUserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Persist to localStorage for next session
    localStorage.setItem('detectedTimezone', cachedUserTimezone);
    return cachedUserTimezone;
  } catch {
    // Fallback to UTC if browser doesn't support timezone detection
    cachedUserTimezone = BROWSER_DETECTION_FALLBACK;
    localStorage.setItem('detectedTimezone', cachedUserTimezone);
    return cachedUserTimezone;
  }
};

/**
 * Clear the timezone cache (useful when user changes system timezone)
 */
export const clearTimezoneCache = (): void => {
  cachedUserTimezone = null;
  hasCheckedLocalStorage = false;
  localStorage.removeItem('detectedTimezone');
};

/**
 * Format UTC date for display in user's timezone
 */
export const formatInUserTimezone = (
  utcDate: string | Date,
  formatStr: string = 'MMM d, yyyy h:mm a',
  timezone?: string
): string => {
  const tz = timezone || getUserTimezone();
  const date = typeof utcDate === 'string' ? parseISO(utcDate) : utcDate;

  // Format the date in the user's timezone
  const formatted = formatInTimeZone(date, tz, formatStr);

  // Add timezone abbreviation
  const tzAbbr = getTimezoneAbbr(tz);
  return `${formatted} ${tzAbbr}`;
};

/**
 * Format date without timezone indicator (for compact displays)
 */
export const formatCompact = (
  utcDate: string | Date,
  formatStr: string = 'MMM d, h:mm a',
  timezone?: string
): string => {
  const tz = timezone || getUserTimezone();
  const date = typeof utcDate === 'string' ? parseISO(utcDate) : utcDate;
  return formatInTimeZone(date, tz, formatStr);
};

/**
 * Convert user's local time to UTC for storage
 */
export const convertLocalToUTC = (localDate: Date, timezone?: string): Date => {
  const tz = timezone || getUserTimezone();
  return fromZonedTime(localDate, tz);
};

/**
 * Convert UTC to user's local time
 */
export const convertUTCToLocal = (utcDate: string | Date, timezone?: string): Date => {
  const tz = timezone || getUserTimezone();
  const date = typeof utcDate === 'string' ? parseISO(utcDate) : utcDate;
  return toZonedTime(date, tz);
};

/**
 * Get timezone abbreviation (EST, PST, etc)
 */
export const getTimezoneAbbr = (timezone?: string): string => {
  const tz = timezone || getUserTimezone();
  const date = new Date();

  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).format(date);

    // Extract the timezone abbreviation from the formatted string
    const parts = formatted.split(' ');
    return parts[parts.length - 1] || tz;
  } catch {
    // Fallback to showing the timezone identifier if formatting fails
    return tz.split('/').pop() || tz;
  }
};

/**
 * Get timezone offset in hours from UTC
 */
export const getTimezoneOffset = (timezone?: string): number => {
  const tz = timezone || getUserTimezone();
  const now = new Date();
  const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  return (tzDate.getTime() - utcDate.getTime()) / (1000 * 60 * 60);
};

/**
 * Format date with relative timezone info for team collaboration
 */
export const formatWithRelativeTimezone = (
  utcDate: string | Date,
  userTimezone: string,
  contentTimezone?: string
): string => {
  const formatted = formatInUserTimezone(utcDate, 'MMM d, yyyy h:mm a', userTimezone);

  // If content was scheduled in a different timezone, show both
  if (contentTimezone && contentTimezone !== userTimezone) {
    const contentFormatted = formatInTimeZone(
      typeof utcDate === 'string' ? parseISO(utcDate) : utcDate,
      contentTimezone,
      'h:mm a zzz'
    );
    return `${formatted} (scheduled as ${contentFormatted})`;
  }

  return formatted;
};

/**
 * Common timezones for UI selection
 */
export const COMMON_TIMEZONES = [
  { value: 'auto', label: '🔄 Auto-detect from browser', group: 'System' },
  {
    value: 'America/New_York',
    label: '🗽 Eastern Time (New York)',
    group: 'US & Canada',
  },
  {
    value: 'America/Chicago',
    label: '🏙️ Central Time (Chicago)',
    group: 'US & Canada',
  },
  {
    value: 'America/Denver',
    label: '🏔️ Mountain Time (Denver)',
    group: 'US & Canada',
  },
  {
    value: 'America/Los_Angeles',
    label: '🌴 Pacific Time (Los Angeles)',
    group: 'US & Canada',
  },
  {
    value: 'America/Phoenix',
    label: '🌵 Arizona Time (no DST)',
    group: 'US & Canada',
  },
  { value: 'America/Anchorage', label: '🐻 Alaska Time', group: 'US & Canada' },
  { value: 'Pacific/Honolulu', label: '🌺 Hawaii Time', group: 'US & Canada' },
  { value: 'America/Toronto', label: '🍁 Toronto Time', group: 'Americas' },
  {
    value: 'America/Mexico_City',
    label: '🇲🇽 Mexico City Time',
    group: 'Americas',
  },
  { value: 'America/Sao_Paulo', label: '🇧🇷 São Paulo Time', group: 'Americas' },
  { value: 'Europe/London', label: '🇬🇧 London Time', group: 'Europe' },
  { value: 'Europe/Paris', label: '🇫🇷 Paris Time', group: 'Europe' },
  { value: 'Europe/Berlin', label: '🇩🇪 Berlin Time', group: 'Europe' },
  { value: 'Europe/Moscow', label: '🇷🇺 Moscow Time', group: 'Europe' },
  { value: 'Asia/Dubai', label: '🇦🇪 Dubai Time', group: 'Asia' },
  { value: 'Asia/Kolkata', label: '🇮🇳 India Time', group: 'Asia' },
  { value: 'Asia/Shanghai', label: '🇨🇳 China Time', group: 'Asia' },
  { value: 'Asia/Tokyo', label: '🇯🇵 Tokyo Time', group: 'Asia' },
  { value: 'Asia/Seoul', label: '🇰🇷 Seoul Time', group: 'Asia' },
  { value: 'Australia/Sydney', label: '🇦🇺 Sydney Time', group: 'Pacific' },
  { value: 'Pacific/Auckland', label: '🇳🇿 Auckland Time', group: 'Pacific' },
  { value: 'UTC', label: '🌍 UTC', group: 'Other' },
];

/**
 * Get display label for a timezone
 */
export const getTimezoneLabel = (timezone: string): string => {
  const tz = COMMON_TIMEZONES.find((t) => t.value === timezone);
  if (tz) return tz.label;

  // Format unknown timezone nicely
  const parts = timezone.split('/');
  if (parts.length > 1) {
    return parts[parts.length - 1].replace(/_/g, ' ');
  }
  return timezone;
};

/**
 * Check if we're currently in Daylight Saving Time for a timezone
 */
export const isDST = (): boolean => {
  const now = new Date();

  // Get January and July dates to compare offsets
  const january = new Date(now.getFullYear(), 0, 1);
  const july = new Date(now.getFullYear(), 6, 1);

  const janOffset = january.getTimezoneOffset();
  const julyOffset = july.getTimezoneOffset();

  // If offsets are different, DST is observed
  // Current offset matching the smaller value means we're in DST
  return now.getTimezoneOffset() === Math.min(janOffset, julyOffset);
};

/**
 * Get optimal posting times for a timezone (Instagram best practices)
 */
export const getOptimalPostingTimes = (): string[] => {
  // Instagram optimal times (in local timezone)
  // Source: Sprout Social research
  return [
    '06:00', // Early morning
    '09:00', // Morning commute
    '12:00', // Lunch break
    '17:00', // After work
    '19:00', // Evening
    '21:00', // Before bed
  ];
};

/**
 * Create a date in a specific timezone with time
 */
export const createDateInTimezone = (
  date: Date,
  time: string, // "HH:mm" format
  timezone?: string
): Date => {
  const tz = timezone || getUserTimezone();
  const [hours, minutes] = time.split(':').map(Number);

  // Create date in the target timezone
  const localDate = new Date(date);
  localDate.setHours(hours, minutes, 0, 0);

  // Convert to UTC for storage
  return fromZonedTime(localDate, tz);
};
