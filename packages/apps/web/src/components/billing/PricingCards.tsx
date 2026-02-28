import { Link } from 'react-router-dom';
import { Check, Crown } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type BillingCycle = 'monthly' | 'annual';

type PricingCardsProps = {
  cycle: BillingCycle;
  proPriceId?: string;
  upgrading: boolean;
  onUpgrade: (priceId: string) => Promise<void> | void;
};

const PRO_FEATURES = [
  'Up to 100 scheduled posts ahead',
  'Higher AI generation capacity',
  'Priority processing on publishing jobs',
  'Billing portal + invoice history',
];

const ENTERPRISE_FEATURES = [
  'Custom limits and throughput',
  'Dedicated onboarding support',
  'Advanced account controls',
  'SLA and priority support',
];

function FeatureList({ features }: { features: string[] }) {
  return (
    <div className="space-y-2 text-sm">
      {features.map((feature) => (
        <div key={feature} className="flex items-start gap-2">
          <Check className="text-muted-foreground mt-0.5 h-4 w-4" />
          <span>{feature}</span>
        </div>
      ))}
    </div>
  );
}

export function PricingCards({ cycle, proPriceId, upgrading, onUpgrade }: PricingCardsProps) {
  const proPriceLabel = cycle === 'annual' ? '$290/year' : '$29/month';

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="flex h-full flex-col">
        <CardHeader>
          <CardTitle>Free</CardTitle>
          <CardDescription>For trying Postolio and lightweight workflows.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-4">
          <div className="text-3xl font-semibold">$0</div>
          <div className="space-y-2 text-sm">
            <div className="flex items-start gap-2">
              <Check className="text-muted-foreground mt-0.5 h-4 w-4" />
              <span>Alpha limits and fair-use guardrails</span>
            </div>
            <div className="flex items-start gap-2">
              <Check className="text-muted-foreground mt-0.5 h-4 w-4" />
              <span>Core scheduling and publishing workflow</span>
            </div>
          </div>
          <Button asChild variant="outline" className="mt-auto w-full">
            <Link to="/register">Get started</Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="border-primary/40 flex h-full flex-col">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5" />
              Pro
            </CardTitle>
            <Badge>Most Popular</Badge>
          </div>
          <CardDescription>Best fit for creators and small teams shipping daily.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-4">
          <div className="text-3xl font-semibold">{proPriceLabel}</div>
          <FeatureList features={PRO_FEATURES} />
          <Button
            className="mt-auto w-full"
            disabled={upgrading || !proPriceId}
            onClick={() => {
              if (!proPriceId) {
                return;
              }
              void onUpgrade(proPriceId);
            }}
          >
            {upgrading ? 'Redirecting...' : 'Upgrade to Pro'}
          </Button>
        </CardContent>
      </Card>

      <Card className="flex h-full flex-col">
        <CardHeader>
          <CardTitle>Enterprise</CardTitle>
          <CardDescription>
            For organizations with custom compliance and scale needs.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-4">
          <div className="text-3xl font-semibold">Custom</div>
          <FeatureList features={ENTERPRISE_FEATURES} />
          <Button asChild variant="outline" className="mt-auto w-full">
            <a href="mailto:hello@postolio.example?subject=Postolio%20Enterprise">Contact sales</a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default PricingCards;
