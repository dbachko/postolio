/**
 * Shared utility for constructing Redis URL from environment variables
 */

/**
 * Constructs Redis URL from environment variables or fallback values
 * @param fallbackUrl - Optional fallback URL for local development
 * @returns Constructed Redis URL
 */
export function getRedisUrl(fallbackUrl = 'redis://localhost:6379'): string {
  // Prefer separate host and port settings when available.
  if (process.env.REDIS_HOST) {
    const host = process.env.REDIS_HOST;
    const port = process.env.REDIS_PORT || '6379';
    return `redis://${host}:${port}`;
  }

  // Fallback for local development configuration
  return process.env.REDIS_URL || fallbackUrl;
}

/**
 * Gets Redis connection options from environment
 * @returns Object with host and port if available, null otherwise
 */
export function getRedisConnectionOptions(): {
  host: string;
  port: number;
} | null {
  if (process.env.REDIS_HOST) {
    return {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    };
  }
  return null;
}
