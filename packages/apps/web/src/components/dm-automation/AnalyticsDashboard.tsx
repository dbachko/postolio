import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dmAutomation } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MessageSquare, Send, Ban, Users, TrendingUp } from 'lucide-react';

interface AnalyticsDashboardProps {
  brandId: string;
}

export function AnalyticsDashboard({ brandId }: AnalyticsDashboardProps) {
  const [days, setDays] = useState(30);

  const { data, isLoading } = useQuery({
    queryKey: ['dm-automation-analytics', brandId, days],
    queryFn: () => dmAutomation.getAnalytics(brandId, days),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center">
            <div className="border-primary h-8 w-8 animate-spin rounded-full border-b-2"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const analytics = data;

  if (!analytics) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-muted-foreground text-center">Failed to load analytics</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Analytics Overview</h2>
          <p className="text-muted-foreground">Automation performance for the last {days} days</p>
        </div>
        <Select value={days.toString()} onValueChange={(value) => setDays(parseInt(value))}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="60">Last 60 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Overview Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Events</CardTitle>
            <MessageSquare className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.overview.totalEvents}</div>
            <p className="text-muted-foreground text-xs">Automation triggers</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Messages Sent</CardTitle>
            <Send className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.overview.messagesSent}</div>
            <p className="text-muted-foreground text-xs">DMs delivered</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Comment Replies</CardTitle>
            <MessageSquare className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.overview.commentRepliesSent}</div>
            <p className="text-muted-foreground text-xs">Comments replied</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unique Users</CardTitle>
            <Users className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.overview.uniqueUsers}</div>
            <p className="text-muted-foreground text-xs">Engaged users</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <TrendingUp className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.overview.successRate.toFixed(1)}%</div>
            <p className="text-muted-foreground text-xs">Successful deliveries</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Rate Limited</CardTitle>
            <Ban className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.overview.rateLimitedEvents}</div>
            <p className="text-muted-foreground text-xs">Throttled events</p>
          </CardContent>
        </Card>
      </div>

      {/* Per-Rule Stats */}
      {analytics.byRule.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Performance by Rule</CardTitle>
            <CardDescription>Breakdown of each automation rule's activity</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {analytics.byRule.map((rule) => (
                <div key={rule.ruleId} className="border-b pb-4 last:border-0">
                  <h4 className="mb-2 font-medium">{rule.ruleName}</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                    <div>
                      <p className="text-muted-foreground">Events</p>
                      <p className="font-semibold">{rule.totalEvents}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">DMs Sent</p>
                      <p className="font-semibold">{rule.messagesSent}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Replies</p>
                      <p className="font-semibold">{rule.commentRepliesSent}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Rate Limited</p>
                      <p className="font-semibold">{rule.rateLimited}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {analytics.byRule.length === 0 && analytics.overview.totalEvents === 0 && (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <p className="text-muted-foreground">
                No automation activity yet. Create and activate rules to start seeing analytics.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
