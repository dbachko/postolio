import { useMemo } from 'react';
import { Users, TrendingDown, TrendingUp } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TimeSeriesChart } from '@/components/analytics-common/time-series-chart';
import { formatNumber, formatPercent } from '@/utils/formatNumber';

type DemographicsStatus =
  'available' | 'no_data' | 'not_connected' | 'insufficient_permissions' | 'error';

interface AudienceDemographics {
  totalAudience: number;
  updatedAt: string;
  gender: Array<{ gender: 'M' | 'F' | 'U'; value: number }>;
  age: Array<{ range: string; value: number }>;
  countries: Array<{ code: string; value: number }>;
  cities: Array<{ name: string; value: number }>;
  locales: Array<{ locale: string; value: number }>;
}

interface AudienceData {
  demographics?: AudienceDemographics | null;
  demographicsStatus?: DemographicsStatus;
  demographicsError?: string | null;
  followerGrowth: {
    current: number;
    change: number;
    changeRate: string;
    timeline: Array<{ date: string; followers: number }>;
  };
}

interface AudienceInsightsProps {
  audienceData?: AudienceData;
  loading?: boolean;
}

type FollowerPoint = { date: string; followers: number };

function normalizeFollowerTimeline(timeline: FollowerPoint[] | undefined): FollowerPoint[] {
  try {
    const byDay = new Map<string, FollowerPoint>();
    for (const point of timeline || []) {
      const dateObj = new Date(point.date);
      const dayKey = isNaN(dateObj.getTime())
        ? String(point.date).slice(0, 10)
        : dateObj.toISOString().slice(0, 10);
      const existing = byDay.get(dayKey);
      if (!existing || point.followers >= existing.followers) {
        byDay.set(dayKey, { date: dayKey, followers: point.followers });
      }
    }
    const result = Array.from(byDay.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
    return result.slice(Math.max(0, result.length - 30));
  } catch {
    return timeline || [];
  }
}

function AudienceInsightsTitle() {
  return (
    <CardTitle className="flex items-center gap-2">
      <Users className="h-5 w-5" />
      <span>Audience Insights</span>
    </CardTitle>
  );
}

function AudienceInsightsLoading() {
  return (
    <Card>
      <CardHeader>
        <AudienceInsightsTitle />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </CardContent>
    </Card>
  );
}

function AudienceInsightsEmpty() {
  return (
    <Card>
      <CardHeader>
        <AudienceInsightsTitle />
      </CardHeader>
      <CardContent>
        <div className="text-muted-foreground py-8 text-center">
          <Users className="mx-auto mb-3 h-12 w-12 opacity-30" />
          <p className="text-sm">No audience data available</p>
          <p className="text-xs">Connect your Instagram Business account to see insights</p>
        </div>
      </CardContent>
    </Card>
  );
}

function countryName(code: string): string {
  try {
    const DisplayNames: unknown = (Intl as any).DisplayNames;
    if (typeof DisplayNames !== 'function') {
      return code;
    }
    const dn = new (DisplayNames as any)(['en'], { type: 'region' });
    return dn.of(code) || code;
  } catch {
    return code;
  }
}

function genderLabel(value: 'M' | 'F' | 'U'): string {
  if (value === 'F') {
    return 'Women';
  }
  if (value === 'M') {
    return 'Men';
  }
  return 'Unknown';
}

function demographicsMessage(
  status: DemographicsStatus | undefined,
  demographics: AudienceDemographics | null
): string | null {
  if (status === 'available' && demographics) {
    return null;
  }
  if (status === 'insufficient_permissions') {
    return 'Demographics are unavailable. Reconnect Instagram and grant Insights permissions.';
  }
  if (status === 'no_data') {
    return 'Instagram has not provided audience demographics yet.';
  }
  if (status === 'not_connected') {
    return 'Connect an Instagram Business/Creator account to see demographics.';
  }
  if (status === 'error') {
    return 'Unable to load demographic data right now.';
  }
  return 'Demographics are not available yet.';
}

function ratioWidth(ratio: number): string {
  const bounded = Math.max(0, Math.min(100, ratio * 100));
  return `${bounded}%`;
}

function ProgressMetric({
  label,
  value,
  totalAudience,
}: {
  label: string;
  value: number;
  totalAudience: number;
}) {
  const ratio = totalAudience > 0 ? value / totalAudience : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {formatPercent(ratio, 1)} • {formatNumber(value)}
        </span>
      </div>
      <div className="bg-muted h-2 w-full rounded">
        <div className="bg-primary h-2 rounded" style={{ width: ratioWidth(ratio) }} />
      </div>
    </div>
  );
}

function FollowerStats({ audienceData }: { audienceData: AudienceData }) {
  const followerGrowth = audienceData.followerGrowth;
  const isPositiveGrowth = followerGrowth.change > 0;
  const GrowthIcon = isPositiveGrowth ? TrendingUp : TrendingDown;
  const growthColor = isPositiveGrowth
    ? 'text-green-600 dark:text-green-400'
    : 'text-red-600 dark:text-red-400';

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="rounded-lg border p-4">
        <div className="text-muted-foreground mb-1 text-sm">Total Followers</div>
        <div className="text-2xl font-bold">{formatNumber(followerGrowth.current)}</div>
      </div>
      <div className="rounded-lg border p-4">
        <div className="text-muted-foreground mb-1 text-sm">Follower Change (30d)</div>
        <div className={`flex items-center gap-2 text-2xl font-bold ${growthColor}`}>
          <GrowthIcon className="h-5 w-5" />
          <span>
            {isPositiveGrowth ? '+' : ''}
            {formatNumber(followerGrowth.change)}
          </span>
        </div>
      </div>
      <div className="rounded-lg border p-4">
        <div className="text-muted-foreground mb-1 text-sm">Growth Rate</div>
        <div className={`text-2xl font-bold ${growthColor}`}>
          {isPositiveGrowth ? '+' : ''}
          {followerGrowth.changeRate}%
        </div>
      </div>
    </div>
  );
}

function DemographicsPanel({
  audienceData,
  demographics,
}: {
  audienceData: AudienceData;
  demographics: AudienceDemographics;
}) {
  const totalAudience =
    demographics.totalAudience || demographics.gender.reduce((sum, g) => sum + (g.value || 0), 0);
  const message = demographicsMessage(audienceData.demographicsStatus, demographics);

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-sm font-medium">Demographics</div>
        {demographics.updatedAt ? (
          <div className="text-muted-foreground text-xs">
            Updated {new Date(demographics.updatedAt).toLocaleDateString()}
          </div>
        ) : null}
      </div>

      {message ? (
        <div className="text-muted-foreground text-xs">
          <p>{message}</p>
          {audienceData.demographicsError ? (
            <p className="mt-1 break-words">{audienceData.demographicsError}</p>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <div className="text-muted-foreground text-xs font-medium">Gender</div>
            {(demographics.gender || []).slice(0, 3).map((entry) => (
              <ProgressMetric
                key={entry.gender}
                label={genderLabel(entry.gender)}
                value={entry.value}
                totalAudience={totalAudience}
              />
            ))}
          </div>

          <div className="space-y-2">
            <div className="text-muted-foreground text-xs font-medium">Age</div>
            {(demographics.age || []).slice(0, 6).map((entry) => (
              <ProgressMetric
                key={entry.range}
                label={entry.range}
                value={entry.value}
                totalAudience={totalAudience}
              />
            ))}
          </div>

          <div className="space-y-3">
            <div className="text-muted-foreground text-xs font-medium">Top Locations</div>
            <div className="space-y-2">
              {(demographics.countries || []).slice(0, 5).map((entry) => (
                <div key={entry.code} className="flex items-center justify-between text-xs">
                  <span className="truncate">{countryName(entry.code)}</span>
                  <span className="text-muted-foreground">
                    {formatPercent(totalAudience > 0 ? entry.value / totalAudience : 0, 1)} •{' '}
                    {formatNumber(entry.value)}
                  </span>
                </div>
              ))}
              {(demographics.cities || []).slice(0, 5).map((entry) => (
                <div key={entry.name} className="flex items-center justify-between text-xs">
                  <span className="truncate">{entry.name}</span>
                  <span className="text-muted-foreground">
                    {formatPercent(totalAudience > 0 ? entry.value / totalAudience : 0, 1)} •{' '}
                    {formatNumber(entry.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function AudienceInsights({ audienceData, loading }: AudienceInsightsProps) {
  const normalizedTimeline = useMemo(
    () => normalizeFollowerTimeline(audienceData?.followerGrowth?.timeline),
    [audienceData?.followerGrowth?.timeline]
  );

  if (loading) {
    return <AudienceInsightsLoading />;
  }
  if (!audienceData) {
    return <AudienceInsightsEmpty />;
  }

  const demographics = audienceData.demographics ?? null;
  const showDemographicsCard = Boolean(audienceData.demographicsStatus || demographics);

  return (
    <Card>
      <CardHeader>
        <AudienceInsightsTitle />
      </CardHeader>
      <CardContent className="space-y-6">
        <FollowerStats audienceData={audienceData} />

        {normalizedTimeline.length > 0 ? (
          <TimeSeriesChart
            title="Follower Growth (Last 30 Days)"
            series={normalizedTimeline.map((point) => ({
              date: point.date,
              value: point.followers,
            }))}
            label="Total followers over time"
          />
        ) : null}

        {showDemographicsCard && demographics ? (
          <DemographicsPanel audienceData={audienceData} demographics={demographics} />
        ) : null}
      </CardContent>
    </Card>
  );
}
