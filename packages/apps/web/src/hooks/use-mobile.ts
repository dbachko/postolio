import { useMediaQuery } from '@/hooks/useMediaQuery';

const MOBILE_BREAKPOINT_PX = 768;

export function useIsMobile() {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
}
