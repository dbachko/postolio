import { useEffect, useState } from 'react';

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') {
      return;
    }
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    // set initial
    setMatches(mql.matches);

    // Prefer modern API if available; fall back to legacy addListener/removeListener
    const anyMql = mql as unknown as {
      addEventListener?: (type: string, listener: (e: MediaQueryListEvent) => void) => void;
      removeEventListener?: (type: string, listener: (e: MediaQueryListEvent) => void) => void;
      addListener?: (listener: (e: MediaQueryListEvent) => void) => void;
      removeListener?: (listener: (e: MediaQueryListEvent) => void) => void;
    };

    if (
      typeof anyMql.addEventListener === 'function' &&
      typeof anyMql.removeEventListener === 'function'
    ) {
      anyMql.addEventListener('change', handler);
      return () => anyMql.removeEventListener!('change', handler);
    }

    if (typeof anyMql.addListener === 'function' && typeof anyMql.removeListener === 'function') {
      anyMql.addListener(handler);
      return () => anyMql.removeListener!(handler);
    }

    // If neither API is present, do nothing
    return () => {};
  }, [query]);

  return matches;
}
