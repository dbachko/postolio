import { getUserTimezone } from '../timezone';
import { getLocalSetting } from '../settings/localSettings';

let cachedTimezone: string | null = null;
let timezoneLastUpdated = 0;

export function makeCachedTimezoneGetter(cacheMs: number) {
  return function getTimezone(): string {
    const now = Date.now();
    // Values are written via setLocalSetting (JSON stringified), so read through the
    // helper to avoid returning quoted strings like "America/Los_Angeles".
    const storedTimezone =
      getLocalSetting<string>('userTimezone') || getLocalSetting<string>('detectedTimezone');

    // Always prefer the freshest value from storage; if a page booted with UTC
    // before detection finished, the next call should immediately pick up the
    // detected timezone instead of waiting for the cache TTL.
    if (storedTimezone) {
      cachedTimezone = storedTimezone;
      timezoneLastUpdated = now;
      return cachedTimezone;
    }

    if (!cachedTimezone || now - timezoneLastUpdated >= cacheMs) {
      cachedTimezone = getUserTimezone();
      timezoneLastUpdated = now;
    }

    return cachedTimezone;
  };
}
