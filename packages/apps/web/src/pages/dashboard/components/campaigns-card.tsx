import { Link } from 'react-router-dom';
import type { Campaign } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

type CampaignsCardProps = {
  isLoading: boolean;
  campaigns: Campaign[];
};

export function CampaignsCard({ isLoading, campaigns }: CampaignsCardProps) {
  return (
    <Card className="lg:col-span-1">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle>Campaigns</CardTitle>
          <p className="text-muted-foreground text-sm">Launch content in minutes.</p>
        </div>
        <Button asChild size="sm">
          <Link to="/campaigns/create">Start</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-2 rounded-md border p-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : campaigns.length === 0 ? (
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              No campaigns yet. Campaigns keep you consistent with less effort.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link to="/campaigns/create">Create your first campaign</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {campaigns
              .filter((c) => ['active', 'preview', 'paused'].includes(c.status))
              .slice(0, 3)
              .map((campaign) => (
                <Link
                  key={campaign.id}
                  to={`/campaigns/${campaign.id}`}
                  className="hover:bg-accent block rounded-md border p-3 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{campaign.name}</span>
                        <Badge
                          variant={
                            campaign.status === 'active'
                              ? 'success'
                              : campaign.status === 'paused'
                                ? 'warning'
                                : 'secondary'
                          }
                        >
                          {campaign.status}
                        </Badge>
                      </div>
                      <div className="text-muted-foreground mt-1 text-xs">
                        {typeof campaign.scheduledCount === 'number'
                          ? `${campaign.scheduledCount} scheduled`
                          : '—'}{' '}
                        •{' '}
                        {typeof campaign.publishedCount === 'number'
                          ? `${campaign.publishedCount} published`
                          : '—'}
                      </div>
                    </div>
                    <span className="text-muted-foreground mt-0.5 text-sm" aria-hidden="true">
                      →
                    </span>
                  </div>
                </Link>
              ))}
            <Button asChild variant="ghost" size="sm" className="mt-1 w-full justify-between">
              <Link to="/campaigns">
                View all campaigns <span aria-hidden="true">→</span>
              </Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
