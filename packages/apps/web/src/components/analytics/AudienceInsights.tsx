import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, TrendingUp, TrendingDown } from 'lucide-react';
import { formatNumber, formatPercent } from '@/utils/formatNumber';
import { TimeSeriesChart } from './TimeSeriesChart';

type DemographicsStatus =
  | 'available'
  | 'no_data'
  | 'not_connected'
  | 'insufficient_permissions'
  | 'error';

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

function normalizeFollowerTimeline(
  timeline: Array<{ date: string; followers: number }> | undefined
): Array<{ date: string; followers: number }> {
  try {
    const byDay = new Map<string, { date: string; followers: number }>();
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

    const arr = Array.from(byDay.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
    return arr.slice(Math.max(0, arr.length - 30));
  } catch {
    return timeline || [];
  }
}

export function AudienceInsights({ audienceData, loading }: AudienceInsightsProps) {
  const normalizedTimeline = useMemo(
    () => normalizeFollowerTimeline(audienceData?.followerGrowth?.timeline),
    [audienceData?.followerGrowth?.timeline]
  );

  const demographicsStatus = audienceData?.demographicsStatus;
  const demographics = audienceData?.demographics ?? null;
  const showDemographicsCard = Boolean(demographicsStatus || demographics);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            <span>Audience Insights</span>
          </CardTitle>
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

  if (!audienceData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            <span>Audience Insights</span>
          </CardTitle>
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

  const { followerGrowth } = audienceData;
  const isPositiveGrowth = followerGrowth.change > 0;
  const GrowthIcon = isPositiveGrowth ? TrendingUp : TrendingDown;
  const growthColor = isPositiveGrowth
    ? 'text-green-600 dark:text-green-400'
    : 'text-red-600 dark:text-red-400';

  const totalAudience =
    demographics?.totalAudience ||
    demographics?.gender?.reduce((sum, g) => sum + (g.value || 0), 0) ||
    0;

  const countryName = (code: string) => {
    try {
      const DisplayNames: any = (Intl as any).DisplayNames;
      if (typeof DisplayNames !== 'function') return code;
      const dn = new DisplayNames(['en'], { type: 'region' });
      return dn.of(code) || code;
    } catch {
      return code;
    }
  };

  const demographicsMessage = (() => {
    if (demographicsStatus === 'available' && demographics) return null;
    if (demographicsStatus === 'insufficient_permissions') {
      return 'Demographics are unavailable. Reconnect Instagram and grant Insights permissions.';
    }
    if (demographicsStatus === 'no_data') {
      return 'Instagram has not provided audience demographics yet.';
    }
    if (demographicsStatus === 'not_connected') {
      return 'Connect an Instagram Business/Creator account to see demographics.';
    }
    if (demographicsStatus === 'error') {
      return 'Unable to load demographic data right now.';
    }
    return 'Demographics are not available yet.';
  })();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          <span>Audience Insights</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Follower Stats */}
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

        {/* Follower Growth Timeline */}
        {normalizedTimeline && normalizedTimeline.length > 0 && (
          <TimeSeriesChart
            title="Follower Growth (Last 30 Days)"
            series={normalizedTimeline.map((point) => ({
              date: point.date,
              value: point.followers,
            }))}
            label="Total followers over time"
          />
        )}

        {/* Demographics */}
        {showDemographicsCard && (
          <div className="rounded-lg border p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="text-sm font-medium">Demographics</div>
              {demographics?.updatedAt ? (
                <div className="text-muted-foreground text-xs">
                  Updated {new Date(demographics.updatedAt).toLocaleDateString()}
                </div>
              ) : null}
            </div>

            {demographicsMessage ? (
              <div className="text-muted-foreground text-xs">
                <p>{demographicsMessage}</p>
                {audienceData.demographicsError ? (
                  <p className="mt-1 break-words">{audienceData.demographicsError}</p>
                ) : null}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-3">
                {/* Gender */}
                <div className="space-y-2">
                  <div className="text-muted-foreground text-xs font-medium">Gender</div>
                  {(demographics?.gender || []).slice(0, 3).map((g) => {
                    const label = g.gender === 'F' ? 'Women' : g.gender === 'M' ? 'Men' : 'Unknown';
                    const ratio = totalAudience > 0 ? g.value / totalAudience : 0;
                    return (
                      <div key={g.gender} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span>{label}</span>
                          <span className="text-muted-foreground">
                            {formatPercent(ratio, 1)} • {formatNumber(g.value)}
                          </span>
                        </div>
                        <div className="bg-muted h-2 w-full rounded">
                          <div
                            className="bg-primary h-2 rounded"
                            style={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Age */}
                <div className="space-y-2">
                  <div className="text-muted-foreground text-xs font-medium">Age</div>
                  {(demographics?.age || []).slice(0, 6).map((a) => {
                    const ratio = totalAudience > 0 ? a.value / totalAudience : 0;
                    return (
                      <div key={a.range} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span>{a.range}</span>
                          <span className="text-muted-foreground">
                            {formatPercent(ratio, 1)} • {formatNumber(a.value)}
                          </span>
                        </div>
                        <div className="bg-muted h-2 w-full rounded">
                          <div
                            className="bg-primary h-2 rounded"
                            style={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Locations */}
                <div className="space-y-3">
                  <div className="text-muted-foreground text-xs font-medium">Top Locations</div>
                  <div className="space-y-2">
                    {(demographics?.countries || []).slice(0, 5).map((c) => (
                      <div key={c.code} className="flex items-center justify-between text-xs">
                        <span className="truncate">{countryName(c.code)}</span>
                        <span className="text-muted-foreground">
                          {formatPercent(totalAudience > 0 ? c.value / totalAudience : 0, 1)} •{' '}
                          {formatNumber(c.value)}
                        </span>
                      </div>
                    ))}
                    {(demographics?.cities || []).slice(0, 5).map((c) => (
                      <div key={c.name} className="flex items-center justify-between text-xs">
                        <span className="truncate">{c.name}</span>
                        <span className="text-muted-foreground">
                          {formatPercent(totalAudience > 0 ? c.value / totalAudience : 0, 1)} •{' '}
                          {formatNumber(c.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
