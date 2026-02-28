import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle, Clock, Gauge, Sparkles } from 'lucide-react';

import UpgradePrompt from '@/components/billing/UpgradePrompt';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import type { BrandLimitBreakdown, ScheduleAheadLimits } from './use-limits-data';

function HeroSection() {
  return (
    <div className="bg-card rounded-lg border p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <AlertTriangle className="text-foreground mt-1 h-5 w-5" />
        <p className="text-muted-foreground">
          Postolio is currently in <span className="font-medium">Alpha</span>. We’re shaping the
          product and testing reliability at small scale. During this phase, we enforce a few
          conservative limits to ensure stability for everyone. Paid plans with higher limits and
          advanced features are available via the billing flow.
        </p>
      </div>
    </div>
  );
}

function ScheduleAheadCard(props: { limits?: ScheduleAheadLimits; isLoading: boolean }) {
  if (props.isLoading) {
    return <div className="text-muted-foreground text-sm">Loading…</div>;
  }

  if (!props.limits) {
    return <div className="text-muted-foreground text-sm">No data</div>;
  }

  return (
    <div>
      <div className="text-2xl font-semibold">
        {Number.isFinite(props.limits.maxAllowed) ? props.limits.maxAllowed : 'Unlimited'}
      </div>
      <div className="text-muted-foreground text-sm">
        You have {props.limits.currentCount} scheduled in the future · Tier: {props.limits.tier}
      </div>
    </div>
  );
}

function PerBrandBreakdown(props: {
  limits?: ScheduleAheadLimits;
  perBrand: BrandLimitBreakdown[];
  isLoading: boolean;
}) {
  if (props.isLoading) {
    return <div className="text-muted-foreground text-sm">Loading brand breakdown…</div>;
  }

  if (props.perBrand.length === 0) {
    return <div className="text-muted-foreground text-sm">No brands found</div>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {props.perBrand.map((brand) => {
        const total = props.limits?.currentCount || 0;
        const share = total > 0 ? Math.round((brand.totalFuture / total) * 100) : 0;
        const cap = Number.isFinite(props.limits?.maxAllowed || 0)
          ? props.limits?.maxAllowed
          : Infinity;

        return (
          <div key={brand.brandId} className="bg-background rounded-lg border p-4">
            <div className="mb-1 text-sm font-medium">{brand.brandName}</div>
            <div className="text-muted-foreground mb-2 text-xs">
              Upcoming scheduled: {brand.scheduled} · Drafts with time: {brand.draft}
            </div>
            <div className="flex items-center justify-between text-sm">
              <div>
                <span className="font-medium">{brand.totalFuture}</span>
                {Number.isFinite(cap as number) && typeof props.limits?.maxAllowed === 'number' ? (
                  <span className="text-muted-foreground"> / {props.limits.maxAllowed}</span>
                ) : null}
              </div>
              <div className="text-muted-foreground">{share}% of capacity</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LimitsOverviewCard(props: {
  limits?: ScheduleAheadLimits;
  perBrand: BrandLimitBreakdown[];
  isLimitsLoading: boolean;
  isPerBrandLoading: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="h-5 w-5" /> Current Account Limits
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="bg-background rounded-lg border p-4">
            <div className="text-muted-foreground mb-2 flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4" /> Schedule Ahead Capacity
            </div>
            <ScheduleAheadCard limits={props.limits} isLoading={props.isLimitsLoading} />
          </div>
          <div className="bg-background rounded-lg border p-4">
            <div className="text-muted-foreground mb-2 flex items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4" /> AI Generation Rate Limits
            </div>
            <div className="text-sm">
              Up to <span className="font-medium">10 requests per minute</span> across intensive AI
              endpoints. If you hit this limit, wait a moment and try again.
            </div>
          </div>
          <div className="bg-background rounded-lg border p-4">
            <div className="text-muted-foreground mb-2 flex items-center gap-2 text-sm">
              <CheckCircle className="h-4 w-4" /> Publishing & General API
            </div>
            <div className="text-sm">
              Typical request ceilings are tuned for reliability (e.g., publishing ~30/min, general
              API ~100/min). Limits may adjust automatically to protect platform health.
            </div>
          </div>
        </div>

        <div className="mt-6">
          <div className="mb-2 text-sm font-medium">Per‑Brand Upcoming Breakdown</div>
          <PerBrandBreakdown
            limits={props.limits}
            perBrand={props.perBrand}
            isLoading={props.isPerBrandLoading}
          />
          <div className="text-muted-foreground mt-2 text-xs">
            Counts include future posts only. Drafts shown here are drafts with a scheduled time.
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function UpgradeSection(props: { effectiveTier: string }) {
  if (props.effectiveTier === 'free') {
    return (
      <UpgradePrompt
        title="Upgrade to Pro"
        description="Unlock higher scheduling capacity, faster workflows, and billing controls."
        ctaLabel="View pricing"
        to="/pricing"
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Current Paid Plan</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground">
          Your account is currently on <span className="font-medium">{props.effectiveTier}</span>.
          Manage payment methods and invoices in billing settings.
        </p>
        <div className="pt-1">
          <Button asChild>
            <Link to="/settings/billing">Manage billing</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FaqSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>FAQ</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div>
          <div className="font-medium">How does the rolling window work?</div>
          <p className="text-muted-foreground">
            Your scheduling queue tries to keep upcoming slots filled. When capacity frees up
            (because a scheduled post is published or you delete one), our background job notices
            within about 30 minutes and fills the next available slot.
          </p>
        </div>
        <div>
          <div className="font-medium">How can I generate new posts if I’m at capacity?</div>
          <p className="text-muted-foreground">
            Free up at least one slot by deleting a future post you no longer need, or wait for a
            scheduled post to publish. Once a slot opens, the rolling window backfills
            automatically. Manual scheduling is also enforced per brand; if you try to schedule
            beyond your tier, you’ll be prompted to reduce future posts or upgrade.
          </p>
        </div>
        <div>
          <div className="font-medium">Why am I seeing a schedule limit banner?</div>
          <p className="text-muted-foreground">
            You’ve reached your current schedule-ahead capacity. You can remove or publish some
            future posts to free up space, or upgrade on the pricing page.
          </p>
        </div>
        <div>
          <div className="font-medium">Do limits change during Alpha?</div>
          <p className="text-muted-foreground">
            Yes, we may adjust limits to keep the service stable while we iterate. We’ll do our best
            to keep changes minimal and clearly communicated.
          </p>
        </div>
        <div>
          <div className="font-medium">How can I request higher limits today?</div>
          <p className="text-muted-foreground">
            If you’re blocked, reach out via support and share your use case. We can often bump
            limits temporarily for evaluation.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

interface LimitsViewProps {
  limits?: ScheduleAheadLimits;
  perBrand: BrandLimitBreakdown[];
  effectiveTier: string;
  isLimitsLoading: boolean;
  isPerBrandLoading: boolean;
}

export function LimitsView(props: LimitsViewProps) {
  return (
    <div className="space-y-6">
      <HeroSection />
      <LimitsOverviewCard
        limits={props.limits}
        perBrand={props.perBrand}
        isLimitsLoading={props.isLimitsLoading}
        isPerBrandLoading={props.isPerBrandLoading}
      />
      <UpgradeSection effectiveTier={props.effectiveTier} />
      <FaqSection />
    </div>
  );
}
