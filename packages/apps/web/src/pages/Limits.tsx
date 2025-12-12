import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle, Clock, Gauge, Sparkles } from 'lucide-react';
import { campaign as campaignApi, httpGet } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function Limits() {
  const limitsQuery = useQuery({
    queryKey: ['limits', 'schedule-ahead'],
    queryFn: () => campaignApi.getScheduleAheadLimit(),
    staleTime: 60 * 1000,
  });

  const limits = limitsQuery.data?.data as
    | { tier: string; maxAllowed: number; currentCount: number }
    | undefined;

  const perBrandQuery = useQuery({
    queryKey: ['limits', 'schedule-ahead', 'by-brand'],
    queryFn: async () => {
      return httpGet('/api/account/limits/schedule-ahead/by-brand');
    },
    staleTime: 60 * 1000,
  });
  const perBrand =
    (perBrandQuery.data?.data as
      | Array<{
          brandId: string;
          brandName: string;
          scheduled: number;
          draft: number;
          totalFuture: number;
        }>
      | undefined) || [];

  return (
    <div className="space-y-6">
      {/* Hero / Intro */}
      <div className="bg-card rounded-lg border p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <AlertTriangle className="text-foreground mt-1 h-5 w-5" />
          <div className="space-y-2">
            <p className="text-muted-foreground">
              Postolio is currently in <span className="font-medium">Alpha</span>. We’re shaping the
              product and testing reliability at small scale. During this phase, we enforce a few
              conservative limits to ensure stability for everyone. Paid plans with higher limits
              and advanced features are coming soon.
            </p>
          </div>
        </div>
      </div>

      {/* Current Account Limits */}
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
              {limitsQuery.isLoading ? (
                <div className="text-muted-foreground text-sm">Loading…</div>
              ) : limits ? (
                <div>
                  <div className="text-2xl font-semibold">
                    {Number.isFinite(limits.maxAllowed) ? limits.maxAllowed : 'Unlimited'}
                  </div>
                  <div className="text-muted-foreground text-sm">
                    You have {limits.currentCount} scheduled in the future · Tier: {limits.tier}
                  </div>
                </div>
              ) : (
                <div className="text-muted-foreground text-sm">No data</div>
              )}
            </div>

            <div className="bg-background rounded-lg border p-4">
              <div className="text-muted-foreground mb-2 flex items-center gap-2 text-sm">
                <Sparkles className="h-4 w-4" /> AI Generation Rate Limits
              </div>
              <div className="text-sm">
                Up to <span className="font-medium">10 requests per minute</span> across intensive
                AI endpoints. If you hit this limit, wait a moment and try again.
              </div>
            </div>

            <div className="bg-background rounded-lg border p-4">
              <div className="text-muted-foreground mb-2 flex items-center gap-2 text-sm">
                <CheckCircle className="h-4 w-4" /> Publishing & General API
              </div>
              <div className="text-sm">
                Typical request ceilings are tuned for reliability (e.g., publishing ~30/min,
                general API ~100/min). Limits may adjust automatically to protect platform health.
              </div>
            </div>
          </div>

          {/* Per‑brand breakdown */}
          <div className="mt-6">
            <div className="mb-2 text-sm font-medium">Per‑Brand Upcoming Breakdown</div>
            {perBrandQuery.isLoading ? (
              <div className="text-muted-foreground text-sm">Loading brand breakdown…</div>
            ) : perBrand.length === 0 ? (
              <div className="text-muted-foreground text-sm">No brands found</div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {perBrand.map((b) => {
                  const total = limits?.currentCount || 0;
                  const share = total > 0 ? Math.round((b.totalFuture / total) * 100) : 0;
                  const cap = Number.isFinite(limits?.maxAllowed || 0)
                    ? limits?.maxAllowed
                    : Infinity;
                  return (
                    <div key={b.brandId} className="bg-background rounded-lg border p-4">
                      <div className="mb-1 text-sm font-medium">{b.brandName}</div>
                      <div className="text-muted-foreground mb-2 text-xs">
                        Upcoming scheduled: {b.scheduled} · Drafts with time: {b.draft}
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <div>
                          <span className="font-medium">{b.totalFuture}</span>
                          {Number.isFinite(cap as number) &&
                            typeof limits?.maxAllowed === 'number' && (
                              <span className="text-muted-foreground"> / {limits?.maxAllowed}</span>
                            )}
                        </div>
                        <div className="text-muted-foreground">{share}% of capacity</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="text-muted-foreground mt-2 text-xs">
              Counts include future posts only. Drafts shown here are drafts with a scheduled time.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Plans Preview */}
      <Card>
        <CardHeader>
          <CardTitle>Coming Soon: Paid Plans</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground">
            We’re planning a simple set of tiers so you can choose what fits your workflow. Final
            details may change, but here’s our current direction:
          </p>
          <ul className="list-disc space-y-1 pl-6 text-sm">
            <li>
              <span className="font-medium">Free</span>: Great for trying Postolio. Reasonable
              scheduling capacity and fair-use API limits.
            </li>
            <li>
              <span className="font-medium">Pro</span>: Higher schedule-ahead capacity, faster AI
              generation allotments, and premium workflow features.
            </li>
            <li>
              <span className="font-medium">Enterprise</span>: Custom limits, SSO/SAML, SLAs, and
              priority support.
            </li>
          </ul>
          <div className="pt-2">
            <Button asChild>
              <Link to="/settings">Notify me when plans launch</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* FAQ */}
      <Card>
        <CardHeader>
          <CardTitle>FAQ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <div className="font-medium">How does the rolling window work?</div>
            <p className="text-muted-foreground">
              Active campaigns try to keep upcoming slots filled. When capacity frees up (because a
              scheduled post is published or you delete one), our background job notices within
              about 30 minutes and generates the next post into the next available slot based on
              your campaign schedule. Starting a campaign also triggers an immediate top‑up.
            </p>
          </div>
          <div>
            <div className="font-medium">How can I generate new posts if I’m at capacity?</div>
            <p className="text-muted-foreground">
              Free up at least one slot by deleting a future post you no longer need, or wait for a
              scheduled post to publish. Once a slot opens, the rolling window backfills
              automatically. Manual scheduling is also enforced per brand; if you try to schedule a
              post beyond your tier, you’ll be prompted to reduce future posts or upgrade.
            </p>
          </div>
          <div>
            <div className="font-medium">Why am I seeing a schedule limit banner?</div>
            <p className="text-muted-foreground">
              You’ve reached your current schedule-ahead capacity. You can remove or publish some
              future posts to free up space, or upgrade once paid plans are available.
            </p>
          </div>
          <div>
            <div className="font-medium">Do limits change during Alpha?</div>
            <p className="text-muted-foreground">
              Yes, we may adjust limits to keep the service stable while we iterate. We’ll do our
              best to keep changes minimal and clearly communicated.
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
    </div>
  );
}
