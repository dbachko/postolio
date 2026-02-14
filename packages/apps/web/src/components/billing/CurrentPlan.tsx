import { Link } from 'react-router-dom';
import type { BillingSubscription } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type CurrentPlanProps = {
  tier: string;
  subscription: BillingSubscription | null;
  processing: boolean;
  onCancel: () => Promise<void> | void;
  onReactivate: () => Promise<void> | void;
};

export function CurrentPlan({
  tier,
  subscription,
  processing,
  onCancel,
  onReactivate,
}: CurrentPlanProps) {
  if (!subscription) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Current plan</CardTitle>
          <CardDescription>Your account is on the free tier.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm">
            Upgrade to Pro to unlock higher scheduling limits and billing management.
          </div>
          <Button asChild>
            <Link to="/pricing">View pricing</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const nextBillingDate = new Date(subscription.currentPeriodEnd).toLocaleDateString();
  const amount = (subscription.price.unitAmount / 100).toFixed(2);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Current plan</CardTitle>
        <CardDescription>Tier: {tier}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 text-sm">
          <div>
            Plan: <span className="font-medium">{subscription.price.productName}</span>
          </div>
          <div>
            Billing: <span className="font-medium">${amount}</span> /{' '}
            {subscription.price.interval || 'one-time'}
          </div>
          <div>
            Status: <span className="font-medium">{subscription.status}</span>
          </div>
          <div>
            Next billing date: <span className="font-medium">{nextBillingDate}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {subscription.cancelAtPeriodEnd ? (
            <Button variant="outline" disabled={processing} onClick={() => void onReactivate()}>
              {processing ? 'Processing...' : 'Reactivate Subscription'}
            </Button>
          ) : (
            <Button variant="outline" disabled={processing} onClick={() => void onCancel()}>
              {processing ? 'Processing...' : 'Cancel at period end'}
            </Button>
          )}
          <Button asChild variant="ghost">
            <Link to="/pricing">Change plan</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default CurrentPlan;
