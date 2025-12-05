import { useQuery } from '@tanstack/react-query';
import { onboarding as onboardingApi } from '@/lib/api';
import type { OnboardingState } from '@/lib/api/onboarding-client';

interface UseOnboardingStatusOptions {
  enabled?: boolean;
}

export function useOnboardingStatus(options: UseOnboardingStatusOptions = {}) {
  const { enabled = true } = options;

  return useQuery({
    queryKey: ['onboarding-status'],
    enabled,
    queryFn: async (): Promise<OnboardingState> => {
      const res = await onboardingApi.getStatus();
      if ('status' in res) {
        return res;
      }
      if ('onboarding' in res && res.onboarding && typeof res.onboarding === 'object') {
        return res.onboarding as OnboardingState;
      }
      throw new Error('Invalid onboarding status response');
    },
    staleTime: 60_000,
  });
}
