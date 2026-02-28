import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { brand as brandApi, type Brand } from '@/lib/api';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { useAuthStore } from '@/stores/authStore';
import { useBrandStore } from '@/stores/brandStore';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SocialAccountsManager } from '@/components/social/social-accounts-manager';

type Step = 'brand' | 'connect';

type CreateFormData = {
  name: string;
  description: string;
};

type CreateBrandMutation = UseMutationResult<{ brand: Brand }, Error, CreateFormData, unknown>;

function LoadingScreen() {
  return (
    <div className="bg-background flex min-h-screen items-center justify-center">
      <div className="border-foreground h-8 w-8 animate-spin rounded-full border-b-2" />
    </div>
  );
}

function BrandCreationCard({
  createFormData,
  setCreateFormData,
  onSubmit,
  isPending,
  errorMessage,
}: {
  createFormData: CreateFormData;
  setCreateFormData: Dispatch<SetStateAction<CreateFormData>>;
  onSubmit: (event: FormEvent) => void;
  isPending: boolean;
  errorMessage: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 1 of 2 - Create your brand</CardTitle>
        <CardDescription>
          Tell us the basics so we can tailor content and scheduling for your brand.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          {errorMessage ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}

          <div>
            <Label htmlFor="brand-name">Brand name</Label>
            <Input
              id="brand-name"
              type="text"
              required
              value={createFormData.name}
              onChange={(event) =>
                setCreateFormData((previous) => ({ ...previous, name: event.target.value }))
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
              onChange={(event) =>
                setCreateFormData((previous) => ({ ...previous, description: event.target.value }))
              }
              placeholder="Briefly describe your brand, tone, and audience."
            />
          </div>

          <div className="flex flex-wrap justify-end gap-3">
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Creating...' : 'Continue to connect accounts'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ConnectedBrandSection({
  targetBrand,
  queryClient,
  navigate,
  setRedirectingToDashboard,
  redirectingToDashboard,
}: {
  targetBrand: Brand;
  queryClient: ReturnType<typeof useQueryClient>;
  navigate: ReturnType<typeof useNavigate>;
  setRedirectingToDashboard: (next: boolean) => void;
  redirectingToDashboard: boolean;
}) {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        We will connect social accounts for: <span className="font-medium">{targetBrand.name}</span>
      </p>
      <SocialAccountsManager
        brand={targetBrand}
        onAccountsChanged={async () => {
          try {
            const response = await brandApi.getConnectedAccounts(targetBrand.id);
            const connected = (response.socialAccounts || []).some(
              (account: any) => !account.disconnected
            );
            if (!connected) {
              return;
            }
            await queryClient.invalidateQueries({ queryKey: ['onboarding-status'] });
            setRedirectingToDashboard(true);
            navigate('/dashboard', { replace: true });
          } catch {
            // ignore connection-status refresh errors in onboarding
          }
        }}
      />
      {redirectingToDashboard ? (
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
      ) : null}
    </div>
  );
}

function ConnectAccountsCard({
  brandsLoading,
  targetBrand,
  onboardingStatus,
  queryClient,
  navigate,
  redirectingToDashboard,
  setRedirectingToDashboard,
  onBack,
}: {
  brandsLoading: boolean;
  targetBrand: Brand | null;
  onboardingStatus: string | undefined;
  queryClient: ReturnType<typeof useQueryClient>;
  navigate: ReturnType<typeof useNavigate>;
  redirectingToDashboard: boolean;
  setRedirectingToDashboard: (next: boolean) => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Step 2 of 2 - Connect social accounts</CardTitle>
          <CardDescription>
            Connect at least one social media account to unlock scheduling and analytics. Today we
            support Instagram Business/Creator accounts and Facebook Pages (via Meta), with more
            platforms coming soon.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {brandsLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="border-foreground h-6 w-6 animate-spin rounded-full border-b-2" />
            </div>
          ) : null}
          {!brandsLoading && !targetBrand ? (
            <Alert>
              <AlertDescription>
                No brand found. Please go back and create a brand first.
              </AlertDescription>
            </Alert>
          ) : null}
          {!brandsLoading && targetBrand ? (
            <ConnectedBrandSection
              targetBrand={targetBrand}
              queryClient={queryClient}
              navigate={navigate}
              setRedirectingToDashboard={setRedirectingToDashboard}
              redirectingToDashboard={redirectingToDashboard}
            />
          ) : null}
        </CardContent>
      </Card>

      {onboardingStatus === 'no_brand' ? (
        <div className="flex flex-wrap justify-start gap-3">
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function useOnboardingStepSync({
  onboarding,
  onboardingLoading,
  navigate,
  setStep,
  setRedirectingToDashboard,
}: {
  onboarding: { status: string } | undefined;
  onboardingLoading: boolean;
  navigate: ReturnType<typeof useNavigate>;
  setStep: (step: Step) => void;
  setRedirectingToDashboard: (next: boolean) => void;
}) {
  useEffect(() => {
    if (!onboarding || onboardingLoading) {
      return;
    }
    if (onboarding.status === 'complete') {
      setRedirectingToDashboard(true);
      const timeoutId = setTimeout(() => navigate('/dashboard', { replace: true }), 350);
      return () => clearTimeout(timeoutId);
    }

    setRedirectingToDashboard(false);
    setStep(onboarding.status === 'brand_no_social' ? 'connect' : 'brand');
  }, [navigate, onboarding, onboardingLoading, setRedirectingToDashboard, setStep]);
}

function OnboardingContent({
  step,
  onboardingStatus,
  createFormData,
  setCreateFormData,
  createBrandMutation,
  createError,
  brandsLoading,
  targetBrand,
  queryClient,
  navigate,
  redirectingToDashboard,
  setRedirectingToDashboard,
  onBackToBrand,
}: {
  step: Step;
  onboardingStatus: string | undefined;
  createFormData: CreateFormData;
  setCreateFormData: Dispatch<SetStateAction<CreateFormData>>;
  createBrandMutation: CreateBrandMutation;
  createError: string;
  brandsLoading: boolean;
  targetBrand: Brand | null;
  queryClient: ReturnType<typeof useQueryClient>;
  navigate: ReturnType<typeof useNavigate>;
  redirectingToDashboard: boolean;
  setRedirectingToDashboard: (next: boolean) => void;
  onBackToBrand: () => void;
}) {
  return (
    <div className="bg-background flex min-h-screen flex-col">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-10">
        <header className="mb-8">
          <h1 className="text-foreground text-2xl font-semibold">Welcome to Postolio</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            To get started, create your first brand and connect at least one social media account.
          </p>
        </header>

        {step === 'brand' && onboardingStatus === 'no_brand' ? (
          <BrandCreationCard
            createFormData={createFormData}
            setCreateFormData={setCreateFormData}
            onSubmit={(event) => {
              event.preventDefault();
              if (!createFormData.name.trim()) {
                return;
              }
              createBrandMutation.mutate(createFormData);
            }}
            isPending={createBrandMutation.isPending}
            errorMessage={createBrandMutation.error ? createError : null}
          />
        ) : null}

        {step === 'connect' ? (
          <ConnectAccountsCard
            brandsLoading={brandsLoading}
            targetBrand={targetBrand}
            onboardingStatus={onboardingStatus}
            queryClient={queryClient}
            navigate={navigate}
            redirectingToDashboard={redirectingToDashboard}
            setRedirectingToDashboard={setRedirectingToDashboard}
            onBack={onBackToBrand}
          />
        ) : null}
      </main>
    </div>
  );
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuthStore();
  const { setSelectedBrand } = useBrandStore();
  const { data: onboarding, isLoading: onboardingLoading } = useOnboardingStatus({
    enabled: isAuthenticated,
  });

  const { data: brandsData, isLoading: brandsLoading } = useQuery<{ brands: Brand[] }>({
    queryKey: ['brands'],
    queryFn: () => brandApi.getBrands(),
    enabled: isAuthenticated,
  });

  const brands = useMemo(() => brandsData?.brands ?? [], [brandsData?.brands]);
  const [step, setStep] = useState<Step>('brand');
  const [redirectingToDashboard, setRedirectingToDashboard] = useState(false);
  const [createFormData, setCreateFormData] = useState<CreateFormData>({
    name: '',
    description: '',
  });

  const createBrandMutation = useMutation<{ brand: Brand }, Error, CreateFormData>({
    mutationFn: (data: CreateFormData) =>
      brandApi.createBrand({ name: data.name, description: data.description }),
    onSuccess: async (response) => {
      await queryClient.invalidateQueries({ queryKey: ['brands'] });
      await queryClient.invalidateQueries({ queryKey: ['onboarding-status'] });
      setSelectedBrand(response.brand as Brand);
      setStep('connect');
    },
  });

  const targetBrand = useMemo(() => {
    if (!brands.length) {
      return null;
    }
    if (onboarding?.activeBrandId) {
      const matched = brands.find((brand) => brand.id === onboarding.activeBrandId);
      if (matched) {
        return matched;
      }
    }
    return brands[0] ?? null;
  }, [brands, onboarding?.activeBrandId]);
  useOnboardingStepSync({
    onboarding: onboarding ? { status: onboarding.status } : undefined,
    onboardingLoading,
    navigate,
    setStep,
    setRedirectingToDashboard,
  });

  if (!isAuthenticated) {
    return null;
  }
  if (onboardingLoading) {
    return <LoadingScreen />;
  }

  const createError =
    createBrandMutation.error?.message || 'Failed to create brand. Please try again.';
  return (
    <OnboardingContent
      step={step}
      onboardingStatus={onboarding?.status}
      createFormData={createFormData}
      setCreateFormData={setCreateFormData}
      createBrandMutation={createBrandMutation}
      createError={createError}
      brandsLoading={brandsLoading}
      targetBrand={targetBrand}
      queryClient={queryClient}
      navigate={navigate}
      redirectingToDashboard={redirectingToDashboard}
      setRedirectingToDashboard={setRedirectingToDashboard}
      onBackToBrand={() => setStep('brand')}
    />
  );
}

export default OnboardingPage;
