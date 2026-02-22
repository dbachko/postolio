import { useEffect, useState } from 'react';
import { useTimezone } from '@/contexts/TimezoneContext';
import { useBrandStore } from '@/stores/brandStore';

/**
 * Resolve the active brand's timezone, preferring the brand's configured postingTimezone.
 * Falls back to the user's timezone while the brand timezone is loading or unavailable.
 */
export function useBrandTimezone(): { brandTimezone: string; brandId: string | undefined } {
  const { timezone: userTimezone, getBrandTimezone } = useTimezone();
  const brand = useBrandStore((s) => s.selectedBrand);
  const [brandTimezone, setBrandTimezone] = useState<string>(
    brand?.postingTimezone || userTimezone
  );

  useEffect(() => {
    let cancelled = false;
    const brandId = brand?.id;
    const fallbackTz = brand?.postingTimezone || userTimezone;
    setBrandTimezone(fallbackTz);

    if (!brandId) {
      return undefined;
    }

    const resolveBrandTimezone = async () => {
      try {
        const tz = await getBrandTimezone(brandId);
        if (!cancelled && tz) {
          setBrandTimezone(tz);
        }
      } catch (error) {
        console.warn('[useBrandTimezone] Failed to resolve brand timezone, using fallback', error);
        if (!cancelled) {
          setBrandTimezone(fallbackTz);
        }
      }
    };
    void resolveBrandTimezone();

    return () => {
      cancelled = true;
    };
  }, [brand?.id, brand?.postingTimezone, getBrandTimezone, userTimezone]);

  return { brandTimezone, brandId: brand?.id };
}
