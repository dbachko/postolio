import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { brand as brandApi, type Brand } from '@/lib/api';
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

type Step = 'brand' | 'connect';

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

  const [step, setStep] = useState<Step>('brand');
  const [redirectingToDashboard, setRedirectingToDashboard] = useState(false);
  const [createFormData, setCreateFormData] = useState({
    name: '',
    description: '',
  });

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

  const targetBrand: Brand | null = useMemo(() => {
    if (!brands.length) return null;
    if (onboarding?.activeBrandId) {
      const match = brands.find((b) => b.id === onboarding.activeBrandId);
      if (match) return match;
    }
    return brands[0] ?? null;
  }, [brands, onboarding?.activeBrandId]);

  useEffect(() => {
    if (!onboarding || onboardingLoading) return;
    if (onboarding.status === 'complete') {
      setRedirectingToDashboard(true);
      const t = setTimeout(() => navigate('/dashboard', { replace: true }), 350);
      return () => clearTimeout(t);
    }

    setRedirectingToDashboard(false);
    if (onboarding.status === 'brand_no_social') {
      setStep('connect');
    } else {
      setStep('brand');
    }
  }, [onboarding, onboardingLoading, navigate]);

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

  return (
    <div className="bg-background flex min-h-screen flex-col">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-10">
        <header className="mb-8">
          <h1 className="text-foreground text-2xl font-semibold">Welcome to Postolio</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            To get started, create your first brand and connect at least one social media account.
          </p>
        </header>

        {step === 'brand' && onboarding?.status === 'no_brand' && (
          <Card>
            <CardHeader>
              <CardTitle>Step 1 of 2 - Create your brand</CardTitle>
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
                    {createBrandMutation.isPending ? 'Creating...' : 'Continue to connect accounts'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {step === 'connect' && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Step 2 of 2 - Connect social accounts</CardTitle>
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
                          <span>All set - taking you to your dashboard.</span>
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
