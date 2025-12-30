import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import { useAuthStore } from '@/stores/authStore';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-32 w-32 animate-spin rounded-full border-b-2"></div>
      </div>
    );
  }

  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
}

export function OnboardingGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  const { data: onboarding, isLoading } = useOnboardingStatus({
    enabled: isAuthenticated && !path.startsWith('/onboarding'),
  });

  if (!isAuthenticated) {
    return null;
  }

  if (path.startsWith('/onboarding')) {
    return <>{children}</>;
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="border-primary h-8 w-8 animate-spin rounded-full border-b-2" />
      </div>
    );
  }

  if (onboarding && (onboarding.status === 'no_brand' || onboarding.status === 'brand_no_social')) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
