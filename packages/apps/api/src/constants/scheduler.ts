/**
 * Scheduler Service Constants
 * Centralized time and configuration constants for the scheduling system
 */

// Time intervals in milliseconds
export const SCHEDULER_TIME_INTERVALS = {
  /** Default scheduling delay when no custom time is provided (24 hours) */
  DEFAULT_SCHEDULE_DELAY_MS: 24 * 60 * 60 * 1000,

  /** Minimum interval between scheduled posts (4 hours) */
  MIN_POST_INTERVAL_MS: 4 * 60 * 60 * 1000,

  /** Daily posting frequency (24 hours) */
  DAILY_INTERVAL_MS: 24 * 60 * 60 * 1000,

  /** Every other day posting frequency (48 hours) */
  EVERY_OTHER_DAY_INTERVAL_MS: 48 * 60 * 60 * 1000,

  /** Weekly posting frequency (168 hours) */
  WEEKLY_INTERVAL_MS: 168 * 60 * 60 * 1000,
} as const;

// Scheduling limits
export const SCHEDULER_LIMITS = {
  /** Maximum number of posts to generate at once in autopilot */
  MAX_AUTOPILOT_POSTS_PER_RUN: 7,

  /** Default number of scheduled posts to retrieve */
  DEFAULT_POSTS_LIMIT: 10,

  /** Target days ahead for content gap analysis */
  TARGET_DAYS_AHEAD: 14,

  /** Default optimal posting hour (9 AM) */
  DEFAULT_POSTING_HOUR: 9,
} as const;

// Sync tolerance for AWS/local stats comparison
export const SYNC_TOLERANCE = 2;

/**
 * Convert hours to milliseconds
 */
export function hoursToMs(hours: number): number {
  return hours * 60 * 60 * 1000;
}

/**
 * Get interval in milliseconds based on posting frequency
 */
export function getPostingIntervalMs(
  frequency: "daily" | "every-other-day" | "weekly",
): number {
  switch (frequency) {
    case "daily":
      return SCHEDULER_TIME_INTERVALS.DAILY_INTERVAL_MS;
    case "every-other-day":
      return SCHEDULER_TIME_INTERVALS.EVERY_OTHER_DAY_INTERVAL_MS;
    case "weekly":
      return SCHEDULER_TIME_INTERVALS.WEEKLY_INTERVAL_MS;
    default:
      return SCHEDULER_TIME_INTERVALS.DAILY_INTERVAL_MS;
  }
}

/**
 * Format a date for EventBridge Scheduler at() expression
 * EventBridge expects format: yyyy-MM-dd'T'HH:mm:ss (no milliseconds, no timezone)
 */
export function formatEventBridgeScheduleTime(
  dateInput: string | Date,
): string {
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date input: ${dateInput}`);
  }

  // Convert to ISO string and remove milliseconds and timezone
  const isoString = date.toISOString();
  const dateTimePart = isoString.split(".")[0];

  if (!dateTimePart) {
    throw new Error(`Failed to format date: ${isoString}`);
  }

  return dateTimePart;
}
