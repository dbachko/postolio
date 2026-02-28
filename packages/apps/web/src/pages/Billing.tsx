import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { billing, brand, type CreditPack } from '@/lib/api';
import CurrentPlan from '@/components/billing/CurrentPlan';
import InvoiceHistory from '@/components/billing/InvoiceHistory';
import CreditTopUp from '@/components/billing/CreditTopUp';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import SettingsLayout from './settings/SettingsLayout';

function useBillingData() {
  const subscriptionQuery = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: () => billing.getSubscription(),
    staleTime: 30_000,
  });
  const invoicesQuery = useQuery({
    queryKey: ['billing', 'invoices'],
    queryFn: () => billing.getInvoices(20),
    staleTime: 30_000,
  });
  const brandsQuery = useQuery({
    queryKey: ['billing', 'brands'],
    queryFn: () => brand.getBrands() as Promise<{ brands: Array<{ id: string; name: string }> }>,
    staleTime: 60_000,
  });

  const tier = subscriptionQuery.data?.tier || 'free';
  const subscription = subscriptionQuery.data?.subscription || null;
  const invoices = invoicesQuery.data?.invoices || [];
  const brands = useMemo(() => brandsQuery.data?.brands || [], [brandsQuery.data]);

  return { tier, subscription, invoices, brands, brandsQuery };
}

function useBillingActions() {
  const queryClient = useQueryClient();
  const cancelMutation = useMutation({
    mutationFn: () => billing.cancelSubscription(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['billing', 'subscription'] });
      toast.success('Subscription updated.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to cancel subscription.');
    },
  });
  const reactivateMutation = useMutation({
    mutationFn: () => billing.reactivateSubscription(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['billing', 'subscription'] });
      toast.success('Subscription reactivated.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to reactivate subscription.');
    },
  });
  const portalMutation = useMutation({
    mutationFn: () => billing.createPortalSession(window.location.href),
    onSuccess: (result) => {
      if (!result?.url) {
        toast.error('Missing customer portal URL.');
        return;
      }
      window.location.assign(result.url);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to open billing portal.');
    },
  });
  const topupMutation = useMutation({
    mutationFn: ({ brandId, creditPack }: { brandId: string; creditPack: CreditPack }) =>
      billing.createCreditCheckout({
        brandId,
        creditPack,
        successUrl: `${window.location.origin}/settings/billing?credits=success`,
        cancelUrl: `${window.location.origin}/settings/billing?credits=cancel`,
      }),
    onSuccess: (result) => {
      if (!result?.url) {
        toast.error('Missing checkout URL.');
        return;
      }
      window.location.assign(result.url);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create credit checkout.');
    },
  });

  return { cancelMutation, reactivateMutation, portalMutation, topupMutation };
}

export function Billing() {
  const { tier, subscription, invoices, brands, brandsQuery } = useBillingData();
  const { cancelMutation, reactivateMutation, portalMutation, topupMutation } = useBillingActions();
  const processingSubscription = cancelMutation.isPending || reactivateMutation.isPending;

  return (
    <SettingsLayout>
      <div className="flex flex-col gap-6">
        <CurrentPlan
          tier={tier}
          subscription={subscription}
          processing={processingSubscription}
          onCancel={async () => {
            await cancelMutation.mutateAsync();
          }}
          onReactivate={async () => {
            await reactivateMutation.mutateAsync();
          }}
        />

        <Card>
          <CardHeader>
            <CardTitle>Manage billing in Stripe</CardTitle>
            <CardDescription>
              Update payment method, download invoices, and manage advanced billing preferences.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button disabled={portalMutation.isPending} onClick={() => portalMutation.mutate()}>
              {portalMutation.isPending ? 'Opening portal...' : 'Open customer portal'}
            </Button>
          </CardContent>
        </Card>

        <CreditTopUp
          brands={brands}
          loading={topupMutation.isPending || brandsQuery.isLoading}
          onPurchase={async (brandId, creditPack) => {
            await topupMutation.mutateAsync({ brandId, creditPack });
          }}
        />

        <InvoiceHistory invoices={invoices} />
      </div>
    </SettingsLayout>
  );
}

export default Billing;
