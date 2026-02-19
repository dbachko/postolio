import type { HttpRequest } from '../http/http';

export type OnboardingStatus = 'no_brand' | 'brand_no_social' | 'complete';

export interface OnboardingState {
  status: OnboardingStatus;
  realBrandCount: number;
  socialConnected: boolean;
  instagramConnected: boolean;
  activeBrandId: string | null;
}

export class OnboardingClient {
  constructor(private request: HttpRequest) {}

  getStatus(): Promise<{ onboarding: OnboardingState } | OnboardingState> {
    return this.request('/api/onboarding/status');
  }
}
