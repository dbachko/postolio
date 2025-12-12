import { Button } from '@/components/ui/button';
import { useNavigate, useLocation } from 'react-router-dom';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { useAuthStore } from '@/stores/authStore';
import { Sparkles } from 'lucide-react';

export function DemoModeBanner() {
  const { isAuthenticated } = useAuthStore();
  const location = useLocation();
  const { data: onboarding } = useOnboardingStatus({ enabled: isAuthenticated });
  const navigate = useNavigate();

  if (!isAuthenticated) return null;
  if (!onboarding || onboarding.status !== 'demo') return null;
  if (location.pathname.startsWith('/onboarding')) return null;

  return (
    <div className="bg-primary/90 text-primary-foreground border-b">
      <div className="flex h-12 items-center justify-between px-4 text-sm sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <div className="truncate">
            <span className="font-medium">You&apos;re in Demo Mode.</span>
            <span className="ml-2 opacity-90">
              Explore a sample brand with fake social data, or switch to your own brand when
              you&apos;re ready.
            </span>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => navigate('/onboarding')}
            className="h-8"
          >
            Exit demo &amp; set up my brand
          </Button>
        </div>
      </div>
    </div>
  );
}
