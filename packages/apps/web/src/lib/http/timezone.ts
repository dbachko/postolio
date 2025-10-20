let cachedTimezone: string | null = null;
let timezoneLastUpdated = 0;

export function makeCachedTimezoneGetter(cacheMs: number) {
  return function getTimezone(): string {
    const now = Date.now();
    if (cachedTimezone && now - timezoneLastUpdated < cacheMs) return cachedTimezone;
    cachedTimezone =
      localStorage.getItem('userTimezone') || localStorage.getItem('detectedTimezone') || 'UTC';
    timezoneLastUpdated = now;
    return cachedTimezone;
  };
}
