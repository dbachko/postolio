import { useEffect, useState } from 'react';
import { useTimezone } from '@/contexts/TimezoneContext';

export function useBrandTimezone(brandId: string) {
  const { timezone: userTz, getBrandTimezone } = useTimezone();
  const [brandTimezone, setBrandTimezone] = useState<string>(userTz);

  useEffect(() => {
    let mounted = true;
    const resolveBrandTimezone = async () => {
      try {
        const tz = await getBrandTimezone(brandId);
        if (mounted && tz) {
          setBrandTimezone(tz);
        }
      } catch {
        if (mounted) {
          setBrandTimezone(userTz);
        }
      }
    };
    void resolveBrandTimezone();
    return () => {
      mounted = false;
    };
  }, [brandId, getBrandTimezone, userTz]);

  return { brandTimezone, setBrandTimezone };
}
