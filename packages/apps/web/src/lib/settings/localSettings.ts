export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getLocalSetting<T = unknown>(key: string, fallback?: T): T | undefined {
  if (!isBrowser()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Fallback to string value when not JSON
      return raw as unknown as T;
    }
  } catch {
    return fallback;
  }
}

export function setLocalSetting<T = unknown>(key: string, value: T): void {
  if (!isBrowser()) return;
  try {
    const serialized = JSON.stringify(value);
    window.localStorage.setItem(key, serialized);
  } catch {
    // ignore quota or serialization errors
  }
}

export function removeLocalSetting(key: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function getNumberSetting(
  key: string,
  opts: { min?: number; max?: number; positive?: boolean } = {}
): number | undefined {
  const raw = getLocalSetting<unknown>(key);
  let n: number | undefined;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string') {
    const parsed = Number(raw);
    n = Number.isFinite(parsed) ? parsed : undefined;
  }
  if (n === undefined || !Number.isFinite(n)) return undefined;
  if (opts.positive && n <= 0) return undefined;
  if (typeof opts.min === 'number' && n < opts.min) n = opts.min;
  if (typeof opts.max === 'number' && n > opts.max) n = opts.max;
  return n;
}

export function setNumberSetting(key: string, value: number): void {
  if (!Number.isFinite(value)) return;
  setLocalSetting<number>(key, value);
}

import { useEffect, useState } from 'react';

export function useLocalSetting<T = unknown>(
  key: string | undefined,
  initialValue: T,
  options: { syncAcrossTabs?: boolean } = {}
): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (!key) return initialValue;
    const stored = getLocalSetting<T>(key);
    return stored !== undefined ? stored : initialValue;
  });

  useEffect(() => {
    if (!key) return;
    setLocalSetting<T>(key, value);
  }, [key, value]);

  useEffect(() => {
    if (!options.syncAcrossTabs || !key || !isBrowser()) return;
    const handler = (e: StorageEvent) => {
      if (e.storageArea !== window.localStorage || e.key !== key) return;
      const next = getLocalSetting<T>(key);
      if (next !== undefined) setValue(next);
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [key, options.syncAcrossTabs]);

  return [value, (v: T) => setValue(v)];
}
