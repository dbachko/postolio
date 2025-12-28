import { useEffect, useState, useRef, type RefObject } from 'react';
import { WIDE_CARD_BREAKPOINT } from '../constants';

/**
 * Hook that tracks card width using ResizeObserver and returns whether it's "wide".
 * Returns a ref to attach to the card element and a boolean for the wide state.
 */
export function useCardWidth(): {
  cardRef: RefObject<HTMLDivElement | null>;
  isWide: boolean;
} {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [isWide, setIsWide] = useState(false);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width ?? 0;
      setIsWide(width >= WIDE_CARD_BREAKPOINT);
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { cardRef, isWide };
}
