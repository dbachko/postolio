import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { billing } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import PricingCards from '@/components/billing/PricingCards';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type BillingCycle = 'monthly' | 'annual';

export function Pricing() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [upgrading, setUpgrading] = useState(false);

  const monthlyPriceId =
    (import.meta.env.VITE_STRIPE_PRICE_PRO_MONTHLY as string | undefined) || '';
  const annualPriceId = (import.meta.env.VITE_STRIPE_PRICE_PRO_ANNUAL as string | undefined) || '';
  const selectedPriceId = useMemo(
    () => (cycle === 'annual' ? annualPriceId : monthlyPriceId),
    [annualPriceId, cycle, monthlyPriceId]
  );

  const handleUpgrade = async (priceId: string) => {
    if (!priceId) {
      toast.error('Missing Stripe price configuration for this billing cycle.');
      return;
    }

    if (!user) {
      navigate('/login');
      return;
    }

    try {
      setUpgrading(true);
      const session = await billing.createCheckoutSession({ priceId });
      if (!session?.url) {
        toast.error('Unable to open checkout.');
        return;
      }
      window.location.assign(session.url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to start checkout.');
    } finally {
      setUpgrading(false);
    }
  };

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Postolio Pricing</h1>
          <p className="text-muted-foreground max-w-2xl">
            Start free, then upgrade to Pro when you need higher limits and full billing controls.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={cycle === 'monthly' ? 'default' : 'outline'}
            onClick={() => setCycle('monthly')}
          >
            Monthly
          </Button>
          <Button
            variant={cycle === 'annual' ? 'default' : 'outline'}
            onClick={() => setCycle('annual')}
          >
            Annual
          </Button>
          {cycle === 'annual' ? (
            <span className="text-muted-foreground text-sm">Save about 17% annually.</span>
          ) : null}
        </div>

        <PricingCards
          cycle={cycle}
          proPriceId={selectedPriceId}
          upgrading={upgrading}
          onUpgrade={handleUpgrade}
        />

        <Card>
          <CardContent className="pt-6 text-sm">
            Prices shown in USD. Taxes and regional currency behavior are handled by Stripe
            checkout.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default Pricing;
