import { Link } from 'react-router-dom';
import { AlertCircle, Megaphone, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type DashboardKpisProps = {
  needsAttentionCount: number;
  newCommentsCount: number;
  commentsInboxPostsCount: number;
  activeCampaignsCount: number;
};

export function DashboardKpis({
  needsAttentionCount,
  newCommentsCount,
  commentsInboxPostsCount,
  activeCampaignsCount,
}: DashboardKpisProps) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Needs Attention</CardTitle>
          <AlertCircle className="text-muted-foreground h-4 w-4" aria-hidden="true" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{needsAttentionCount}</div>
          <p className="text-muted-foreground text-xs">Failed posts or connection issues.</p>
          <div className="mt-3">
            <Button asChild size="sm" variant="link" className="h-auto p-0">
              <a href="#needs-attention">Review issues →</a>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">New Comments</CardTitle>
          <MessageSquare className="text-muted-foreground h-4 w-4" aria-hidden="true" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{newCommentsCount}</div>
          <p className="text-muted-foreground text-xs">Across {commentsInboxPostsCount} posts.</p>
          <div className="mt-3">
            <Button asChild size="sm" variant="link" className="h-auto p-0">
              <Link to="/inbox">Open inbox →</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Active Campaigns</CardTitle>
          <Megaphone className="text-muted-foreground h-4 w-4" aria-hidden="true" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{activeCampaignsCount}</div>
          <p className="text-muted-foreground text-xs">Keep your schedule consistent.</p>
          <div className="mt-3">
            <Button asChild size="sm" variant="link" className="h-auto p-0">
              <Link to="/campaigns">View campaigns →</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
