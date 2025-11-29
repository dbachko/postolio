import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ensureLocalStorage = () => {
  if (typeof localStorage === 'undefined' || typeof (localStorage as any).getItem !== 'function') {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
    };
  }
};

describe('makeCachedTimezoneGetter', () => {
  beforeEach(() => {
    ensureLocalStorage();
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    ensureLocalStorage();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('refreshes cached timezone when storage is populated after first call', async () => {
    const { makeCachedTimezoneGetter } = await import('./timezone');
    const getTimezone = makeCachedTimezoneGetter(30_000);

    const initial = getTimezone();
    const nextTimezone = initial === 'America/Los_Angeles' ? 'Asia/Tokyo' : 'America/Los_Angeles';

    localStorage.setItem('userTimezone', nextTimezone);

    const updated = getTimezone();
    expect(updated).toBe(nextTimezone);
  });

  it('returns unquoted timezone when value is JSON-stringified in storage', async () => {
    const { makeCachedTimezoneGetter } = await import('./timezone');
    const getTimezone = makeCachedTimezoneGetter(30_000);

    // Simulate storage written via setLocalSetting (JSON stringified)
    localStorage.setItem('userTimezone', '"America/New_York"');

    const tz = getTimezone();
    expect(tz).toBe('America/New_York');
  });
});
