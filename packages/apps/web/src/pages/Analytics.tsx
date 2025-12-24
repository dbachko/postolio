import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBrandStore } from '../stores/brandStore';
import { brand as brandApi } from '../lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/PageHeader';
import { useQuery } from '@tanstack/react-query';

/**
 * Analytics Landing Page
 *
 * Redirects to the first connected social account's analytics page.
 * This follows the "Account-First" architecture where analytics
 * is always viewed at the per-account level.
 */
export default function Analytics() {
  const navigate = useNavigate();
  const { selectedBrand } = useBrandStore();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['connected-accounts', selectedBrand?.id],
    queryFn: async () => {
      if (!selectedBrand?.id) return null;
      return brandApi.getConnectedAccounts(selectedBrand.id);
    },
    enabled: Boolean(selectedBrand?.id),
    staleTime: 30_000,
  });

  const accounts = data?.socialAccounts || [];
  const connectedAccounts = accounts.filter((a) => !a.disconnected);

  useEffect(() => {
    // Redirect to first connected account when data is loaded
    if (!isLoading && connectedAccounts.length > 0) {
      navigate(`/analytics/accounts/${connectedAccounts[0].id}`, { replace: true });
    }
  }, [connectedAccounts, isLoading, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <PageHeader title="Analytics" description="Loading your analytics..." />
        <div className="mt-6 space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen">
        <PageHeader title="Analytics" description="Performance metrics and insights" />
        <Alert variant="destructive" className="mt-6">
          <AlertDescription>
            Failed to load your connected accounts. Please try again.
          </AlertDescription>
        </Alert>
        <div className="mt-4">
          <Button onClick={() => window.location.reload()}>Retry</Button>
        </div>
      </div>
    );
  }

  if (connectedAccounts.length === 0) {
    return (
      <div className="min-h-screen">
        <PageHeader title="Analytics" description="Performance metrics and insights" />
        <Alert className="mt-6">
          <AlertDescription className="flex flex-col gap-4">
            <span>
              No connected social accounts found. Connect a social media account to view analytics.
            </span>
            <div>
              <Button onClick={() => navigate('/social-accounts')}>Connect Account</Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Fallback while redirecting
  return (
    <div className="min-h-screen">
      <PageHeader title="Analytics" description="Redirecting to your account..." />
      <div className="mt-6">
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}
