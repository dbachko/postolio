import { useState, type ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Ban, MessageSquare, Send, TrendingUp, Users } from 'lucide-react';

import { dmAutomation } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface AnalyticsDashboardProps {
  brandId: string;
}

type OverviewStats = {
  totalEvents: number;
  messagesSent: number;
  commentRepliesSent: number;
  uniqueUsers: number;
  successRate: number;
  rateLimitedEvents: number;
};

type RuleStats = {
  ruleId: string;
  ruleName: string;
  totalEvents: number;
  messagesSent: number;
  commentRepliesSent: number;
  rateLimited: number;
};

type AnalyticsResponse = {
  overview: OverviewStats;
  byRule: RuleStats[];
};

function LoadingCard() {
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

function ErrorCard() {
  return (
    <Card>
      <CardContent className="py-8">
        <p className="text-muted-foreground text-center">Failed to load analytics</p>
      </CardContent>
    </Card>
  );
}

function OverviewStatCard(props: {
  title: string;
  value: string | number;
  description: string;
  icon: ComponentType<{ className?: string }>;
}) {
  const Icon = props.icon;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{props.title}</CardTitle>
        <Icon className="text-muted-foreground h-4 w-4" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{props.value}</div>
        <p className="text-muted-foreground text-xs">{props.description}</p>
      </CardContent>
    </Card>
  );
}

function OverviewStatsGrid(props: { overview: OverviewStats }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <OverviewStatCard
        title="Total Events"
        value={props.overview.totalEvents}
        description="Automation triggers"
        icon={MessageSquare}
      />
      <OverviewStatCard
        title="Messages Sent"
        value={props.overview.messagesSent}
        description="DMs delivered"
        icon={Send}
      />
      <OverviewStatCard
        title="Comment Replies"
        value={props.overview.commentRepliesSent}
        description="Comments replied"
        icon={MessageSquare}
      />
      <OverviewStatCard
        title="Unique Users"
        value={props.overview.uniqueUsers}
        description="Engaged users"
        icon={Users}
      />
      <OverviewStatCard
        title="Success Rate"
        value={`${props.overview.successRate.toFixed(1)}%`}
        description="Successful deliveries"
        icon={TrendingUp}
      />
      <OverviewStatCard
        title="Rate Limited"
        value={props.overview.rateLimitedEvents}
        description="Throttled events"
        icon={Ban}
      />
    </div>
  );
}

function RulePerformanceCard(props: { byRule: RuleStats[] }) {
  if (props.byRule.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Performance by Rule</CardTitle>
        <CardDescription>Breakdown of each automation rule's activity</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {props.byRule.map((rule) => (
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
  );
}

function EmptyActivityCard(props: { show: boolean }) {
  if (!props.show) {
    return null;
  }

  return (
    <Card>
      <CardContent className="py-12">
        <div className="text-center">
          <p className="text-muted-foreground">
            No automation activity yet. Create and activate rules to start seeing analytics.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function AnalyticsDashboardContent(props: {
  analytics: AnalyticsResponse;
  days: number;
  setDays: (days: number) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Analytics Overview</h2>
          <p className="text-muted-foreground">
            Automation performance for the last {props.days} days
          </p>
        </div>
        <Select
          value={props.days.toString()}
          onValueChange={(value) => props.setDays(parseInt(value, 10))}
        >
          <SelectTrigger className="w-full sm:w-[180px]">
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

      <OverviewStatsGrid overview={props.analytics.overview} />
      <RulePerformanceCard byRule={props.analytics.byRule} />
      <EmptyActivityCard
        show={props.analytics.byRule.length === 0 && props.analytics.overview.totalEvents === 0}
      />
    </div>
  );
}

export function AnalyticsDashboard({ brandId }: AnalyticsDashboardProps) {
  const [days, setDays] = useState(30);

  const { data, isLoading } = useQuery({
    queryKey: ['dm-automation-analytics', brandId, days],
    queryFn: () => dmAutomation.getAnalytics(brandId, days),
  });

  if (isLoading) {
    return <LoadingCard />;
  }

  if (!data) {
    return <ErrorCard />;
  }

  return (
    <AnalyticsDashboardContent
      analytics={data as AnalyticsResponse}
      days={days}
      setDays={setDays}
    />
  );
}
