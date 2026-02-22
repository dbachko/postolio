import { useEffect, useState } from 'react';

export function usePostEditorBrandTimezone(params: {
  postBrandId: string | null;
  selectedBrandId: string | null;
  timezone: string;
  getBrandTimezone: (brandId: string) => Promise<string | null>;
}) {
  const { getBrandTimezone, postBrandId, selectedBrandId, timezone } = params;
  const [brandTimezone, setBrandTimezone] = useState<string>(timezone);

  useEffect(() => {
    let mounted = true;
    const resolveBrandTimezone = async () => {
      const brandId = postBrandId ?? selectedBrandId;
      if (!brandId) {
        return;
      }
      try {
        const tz = await getBrandTimezone(brandId);
        if (mounted && tz) {
          setBrandTimezone(tz);
        }
      } catch {
        if (mounted) {
          setBrandTimezone(timezone);
        }
      }
    };
    void resolveBrandTimezone();
    return () => {
      mounted = false;
    };
  }, [getBrandTimezone, postBrandId, selectedBrandId, timezone]);

  return brandTimezone;
}
