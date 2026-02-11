/**
 * Centralized cache configuration for React Query
 *
 * Standard cache durations for different types of data:
 * - Real-time: Data that changes frequently and needs to be fresh
 * - Fresh: Data that should be relatively current
 * - Standard: Data that can be cached for moderate periods
 * - Long: Data that rarely changes
 * - Static: Data that almost never changes
 */

export const CACHE_TIMES = {
  /**
   * Real-time data (5 seconds)
   * Use for: Live updates, active polling, real-time status
   */
  REALTIME: 5_000,

  /**
   * Fresh data (30 seconds)
   * Use for: Active user sessions, frequently changing data
   */
  FRESH: 30_000,

  /**
   * Standard data (1 minute)
   * Use for: General API responses, user data
   */
  STANDARD: 60_000,

  /**
   * Medium-term data (5 minutes)
   * Use for: Analytics, calendars
   */
  MEDIUM: 5 * 60_000,

  /**
   * Long-term data (1 hour)
   * Use for: Configuration, best times, rarely changing analytics
   */
  LONG: 60 * 60_000,

  /**
   * Static data (Infinity)
   * Use for: Immutable data, one-time fetches
   */
  STATIC: Infinity,
} as const;

/**
 * Garbage collection times (how long to keep unused data in cache)
 */
export const GC_TIMES = {
  /**
   * Short-lived cache (5 minutes)
   * For data that's unlikely to be reused
   */
  SHORT: 5 * 60_000,

  /**
   * Standard cache (30 minutes)
   * For most general data
   */
  STANDARD: 30 * 60_000,

  /**
   * Long-lived cache (1 hour)
   * For expensive queries or rarely changing data
   */
  LONG: 60 * 60_000,
} as const;

/**
 * Refetch intervals for polling
 */
export const REFETCH_INTERVALS = {
  /**
   * Fast polling (1.5 seconds)
   * Use for: Active operations, sync status
   */
  FAST: 1500,

  /**
   * Standard polling (5 seconds)
   * Use for: General status updates
   */
  STANDARD: 5000,

  /**
   * Slow polling (30 seconds)
   * Use for: Background updates
   */
  SLOW: 30_000,
} as const;
