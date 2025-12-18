import type { HttpRequest } from '../http/http';

export type OnboardingStatus = 'no_brand' | 'brand_no_social' | 'complete' | 'demo';

export interface OnboardingState {
  status: OnboardingStatus;
  realBrandCount: number;
  socialConnected: boolean;
  instagramConnected: boolean;
  activeBrandId: string | null;
  demoBrandId: string | null;
}

export class OnboardingClient {
  constructor(private request: HttpRequest) {}

  getStatus(): Promise<{ onboarding: OnboardingState } | OnboardingState> {
    return this.request('/api/onboarding/status');
  }

  startDemo(): Promise<{
    onboarding: OnboardingState;
    demoBrand?: { id: string; name: string };
    demoSocialAccountId?: string | null;
  }> {
    return this.request('/api/onboarding/demo', {
      method: 'POST',
    });
  }
}
