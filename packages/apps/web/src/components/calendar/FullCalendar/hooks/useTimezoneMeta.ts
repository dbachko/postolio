import { useEffect, useMemo, useRef } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { getTimezoneAbbr, getTimezoneOffset } from '@/lib/timezone';
import { buildTimezoneLabel, formatGmtOffset } from '../utils/timezone';

export function useTimezoneMeta(brandTimezone: string) {
  const tzRef = useRef<string>(brandTimezone);
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    tzRef.current = brandTimezone;
  }, [brandTimezone]);

  const weekStartsOn = useMemo<0 | 1>(
    () => (user?.weekStart === 'sunday' ? 0 : 1),
    [user?.weekStart]
  );
  const tzAbbr = useMemo(() => getTimezoneAbbr(brandTimezone), [brandTimezone]);
  const tzOffset = useMemo(
    () => formatGmtOffset(getTimezoneOffset(brandTimezone)),
    [brandTimezone]
  );
  const tzLabel = useMemo(() => buildTimezoneLabel(tzAbbr, tzOffset), [tzAbbr, tzOffset]);

  return {
    tzRef,
    tzLabel,
    tzTitle: brandTimezone,
    weekStartsOn,
  };
}
