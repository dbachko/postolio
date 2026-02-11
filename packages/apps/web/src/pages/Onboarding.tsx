import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { brand as brandApi, onboarding as onboardingApi, type Brand } from '@/lib/api';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { useAuthStore } from '@/stores/authStore';
import { useBrandStore } from '@/stores/brandStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SocialAccountsManager } from '@/components/social/social-accounts-manager';

type Step = 'choice' | 'brand' | 'connect';

export function OnboardingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuthStore();
  const { setSelectedBrand } = useBrandStore();
  const { data: onboarding, isLoading: onboardingLoading } = useOnboardingStatus({
    enabled: isAuthenticated,
  });

  const { data: brandsData, isLoading: brandsLoading } = useQuery({
    queryKey: ['brands'],
    queryFn: () => brandApi.getBrands(),
    enabled: isAuthenticated,
  });

  const brands: Brand[] = brandsData?.brands ?? [];

  const [step, setStep] = useState<Step>('choice');
  const [redirectingToDashboard, setRedirectingToDashboard] = useState(false);
  const [createFormData, setCreateFormData] = useState({
    name: '',
    description: '',
  });

  const [demoError, setDemoError] = useState<string | null>(null);

  const createBrandMutation = useMutation({
    mutationFn: (data: typeof createFormData) =>
      brandApi.createBrand({
        name: data.name,
        description: data.description,
      }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ['brands'] });
      await queryClient.invalidateQueries({ queryKey: ['onboarding-status'] });
      setSelectedBrand(res.brand as Brand);
      setStep('connect');
    },
  });

  const demoMutation = useMutation({
    mutationFn: () => onboardingApi.startDemo(),
    onSuccess: async (res) => {
      setDemoError(null);
      const onboardingState = res.onboarding;

      if (res.demoBrand) {
        setSelectedBrand(res.demoBrand as Brand);
      }

      await queryClient.invalidateQueries({ queryKey: ['brands'] });
      await queryClient.invalidateQueries({ queryKey: ['onboarding-status'] });

      if (onboardingState.status === 'demo') {
        navigate('/', { replace: true });
      }
    },
    onError: (error: any) => {
      const message = error?.message || 'Failed to start demo mode. Please try again.';
      setDemoError(message);
    },
  });

  const targetBrand: Brand | null = useMemo(() => {
    if (!brands.length) return null;
    if (onboarding?.activeBrandId) {
      const match = brands.find((b) => b.id === onboarding.activeBrandId);
      if (match) return match;
    }
    return brands[0] ?? null;
  }, [brands, onboarding?.activeBrandId, brands.length]);

  useEffect(() => {
    if (!onboarding || onboardingLoading) return;
    if (onboarding.status === 'complete') {
      setRedirectingToDashboard(true);
      const t = setTimeout(() => navigate('/dashboard', { replace: true }), 350);
      return () => clearTimeout(t);
    }
    setRedirectingToDashboard(false);
    if (step === 'choice') {
      if (onboarding.status === 'brand_no_social') {
        setStep('connect');
      } else if (onboarding.status === 'no_brand') {
        setStep('choice');
      } else if (onboarding.status === 'demo') {
        setStep('brand');
      }
    }
  }, [onboarding, onboardingLoading, navigate, step]);

  if (!isAuthenticated) {
    return null;
  }

  if (onboardingLoading) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="border-foreground h-8 w-8 animate-spin rounded-full border-b-2" />
      </div>
    );
  }

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!createFormData.name.trim()) return;
    createBrandMutation.mutate(createFormData);
  };

  const showChoice = step === 'choice' && onboarding?.status === 'no_brand';

  return (
    <div className="bg-background flex min-h-screen flex-col">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-10">
        <header className="mb-8">
          <h1 className="text-foreground text-2xl font-semibold">Welcome to Postolio</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            To get started, create your first brand and connect at least one social media account.
            New users can also explore Postolio in demo mode before creating a brand.
          </p>
          {onboarding?.status === 'demo' && (
            <p className="text-muted-foreground mt-1 text-xs">
              You&apos;re currently in Demo Mode. Create your own brand below to switch to a real
              workspace.
            </p>
          )}
        </header>

        {demoError && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{demoError}</AlertDescription>
          </Alert>
        )}

        {showChoice && (
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="flex h-full flex-col">
              <CardHeader>
                <CardTitle>Set up your brand</CardTitle>
                <CardDescription>
                  Recommended for using Postolio with your own social accounts.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between">
                <div className="space-y-4">
                  <p className="text-muted-foreground text-sm">
                    You will create a brand profile and then connect at least one social media
                    account (starting with Instagram Business or Creator). This takes about two
                    minutes.
                  </p>
                </div>
                <Button onClick={() => setStep('brand')} className="mt-6 w-full">
                  Start setup
                </Button>
              </CardContent>
            </Card>

            <Card className="flex h-full flex-col">
              <CardHeader>
                <CardTitle>Explore Demo Mode</CardTitle>
                <CardDescription>
                  See a live example brand with demo social connections.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between">
                <div className="space-y-4">
                  <p className="text-muted-foreground text-sm">
                    Great for quickly exploring the calendar, analytics, and content generation
                    without connecting your own account yet.
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="mt-6 w-full"
                  onClick={() => demoMutation.mutate()}
                  disabled={demoMutation.isPending}
                >
                  {demoMutation.isPending ? 'Starting demo…' : 'Enter demo mode'}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {demoMutation.isPending && (
          <div className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Preparing your demo workspace…</CardTitle>
                <CardDescription>
                  We&apos;re generating a sample brand and posts so you can explore Postolio without
                  connecting real accounts. This usually takes just a few seconds.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
                  <li>Edit demo posts freely — they never publish anywhere.</li>
                  <li>
                    Try scheduling a post to see how it appears in the calendar and inbox views.
                  </li>
                  <li>
                    When you&apos;re ready, create your own brand to switch from demo to a real
                    workspace.
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        )}

        {!showChoice &&
          step === 'brand' &&
          (onboarding?.status === 'no_brand' || onboarding?.status === 'demo') && (
            <Card>
              <CardHeader>
                <CardTitle>Step 1 of 2 – Create your brand</CardTitle>
                <CardDescription>
                  Tell us the basics so we can tailor content and scheduling for your brand.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCreateSubmit} className="space-y-4">
                  {createBrandMutation.error && (
                    <Alert variant="destructive">
                      <AlertDescription>
                        {createBrandMutation.error.message ||
                          'Failed to create brand. Please try again.'}
                      </AlertDescription>
                    </Alert>
                  )}

                  <div>
                    <Label htmlFor="brand-name">Brand name</Label>
                    <Input
                      id="brand-name"
                      type="text"
                      required
                      value={createFormData.name}
                      onChange={(e) =>
                        setCreateFormData((prev) => ({ ...prev, name: e.target.value }))
                      }
                      placeholder="e.g. Acme Studio"
                    />
                  </div>

                  <div>
                    <Label htmlFor="brand-description">Description</Label>
                    <Textarea
                      id="brand-description"
                      rows={3}
                      value={createFormData.description}
                      onChange={(e) =>
                        setCreateFormData((prev) => ({ ...prev, description: e.target.value }))
                      }
                      placeholder="Briefly describe your brand, tone, and audience."
                    />
                  </div>

                  <div className="flex flex-wrap justify-end gap-3">
                    <Button type="submit" disabled={createBrandMutation.isPending}>
                      {createBrandMutation.isPending ? 'Creating…' : 'Continue to connect accounts'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

        {!showChoice && step === 'connect' && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Step 2 of 2 – Connect social accounts</CardTitle>
                <CardDescription>
                  Connect at least one social media account to unlock scheduling and analytics.
                  Today we support Instagram Business/Creator accounts and Facebook Pages (via
                  Meta), with more platforms coming soon.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {brandsLoading && (
                  <div className="flex items-center justify-center py-8">
                    <div className="border-foreground h-6 w-6 animate-spin rounded-full border-b-2" />
                  </div>
                )}
                {!brandsLoading && !targetBrand && (
                  <Alert>
                    <AlertDescription>
                      No brand found. Please go back and create a brand first.
                    </AlertDescription>
                  </Alert>
                )}
                {!brandsLoading && targetBrand && (
                  <div className="space-y-4">
                    <p className="text-muted-foreground text-sm">
                      We will connect social accounts for:{' '}
                      <span className="font-medium">{targetBrand.name}</span>
                    </p>
                    <SocialAccountsManager
                      brand={targetBrand}
                      onAccountsChanged={async () => {
                        try {
                          const res = await brandApi.getConnectedAccounts(targetBrand.id);
                          const connected = (res.socialAccounts || []).some(
                            (a: any) => !a.disconnected
                          );
                          if (!connected) return;
                          await queryClient.invalidateQueries({ queryKey: ['onboarding-status'] });
                          setRedirectingToDashboard(true);
                          navigate('/dashboard', { replace: true });
                        } catch (_e) {
                          // ignore
                        }
                      }}
                    />

                    {redirectingToDashboard && (
                      <Alert variant="info">
                        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                          <span>All set — taking you to your dashboard.</span>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => navigate('/dashboard', { replace: true })}
                          >
                            Go to dashboard
                          </Button>
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {onboarding?.status === 'no_brand' && (
              <div className="flex flex-wrap justify-start gap-3">
                <Button type="button" variant="outline" onClick={() => setStep('brand')}>
                  Back
                </Button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default OnboardingPage;
