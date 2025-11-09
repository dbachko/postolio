import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { brand as brandApi, httpGet, httpPut, httpDelete, analyticsV2 } from '../lib/api';
import { PageHeader } from '@/components/PageHeader';
import { toast } from 'sonner';
// Deprecated legacy chart removed; using v2 charts below
import SchedulingPanel from '../components/SchedulingPanel';
import { useBrandStore } from '../stores/brandStore';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MetricsCard } from '../components/analytics/MetricsCard';
import { Eye, Heart, Users } from 'lucide-react';
import { TimeSeriesChart } from '../components/analytics/TimeSeriesChart';

interface AnalyticsReport {
  totalPosts: number;
  totalImpressions: number;
  totalReach: number;
  totalEngagements: number;
  averageEngagementRate: number;
  optimalTimes: Array<{
    dayOfWeek: number;
    hour: number;
    engagementScore: number;
    sampleSize: number;
    dayName: string;
    timeFormatted: string;
  }>;
  topPerformingPosts: Array<{
    postId: string;
    impressions: number;
    reach: number;
    likes: number;
    comments: number;
    saves: number;
    shares: number;
    engagementRate: number;
    timestamp: string;
  }>;
  engagementTrends: Array<{
    date: string;
    engagementRate: number;
  }>;
}

interface SchedulingStats {
  scheduled: number;
  posted: number;
  failed: number;
  draft: number;
}

interface ScheduledPost {
  id: string;
  caption: string;
  imageUrl: string;
  // Some scheduled posts may not include hashtags
  hashtags?: string[];
  scheduledTime: string;
  status: string;
}

// Instagram analytics types
// legacy IG types removed; Instagram tab derives from v2 endpoints

export default function Analytics() {
  const { selectedBrand } = useBrandStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState<'overview' | 'instagram' | 'scheduling'>(
    (['overview', 'instagram', 'scheduling'].includes(urlTab) ? urlTab : 'overview') as
      | 'overview'
      | 'instagram'
      | 'scheduling'
  );
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [schedulingStats, setSchedulingStats] = useState<SchedulingStats | null>(null);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [daysPeriod, setDaysPeriod] = useState(30);

  // Instagram analytics state
  // Instagram tab derived from v2 endpoints
  const [igOverview, setIgOverview] = useState<{
    followers?: number;
    impressions?: number;
    reach?: number;
    profile_views?: number;
  } | null>(null);
  const [igPosts, setIgPosts] = useState<
    Array<{ id: string; caption?: string; permalink?: string; publishedAt?: string; metrics?: any }>
  >([]);
  const [igSeries, setIgSeries] = useState<
    Array<{ date: string; impressions: number; reach: number; profile_views: number }>
  >([]);
  const [igLoading, setIgLoading] = useState(false);

  // Initial brands load on mount

  useEffect(() => {
    loadBrands();
  }, []);

  // Sync active tab with URL param
  useEffect(() => {
    const current = searchParams.get('tab') || 'overview';
    if (current !== activeTab) {
      setActiveTab(
        (['overview', 'instagram', 'scheduling'].includes(current) ? current : 'overview') as
          | 'overview'
          | 'instagram'
          | 'scheduling'
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Fetch analytics when brand or period changes
  useEffect(() => {
    if (selectedBrand?.id) {
      loadAnalytics();
      loadSchedulingData();
      // Load Instagram data lazily when brand changes and tab might be instagram
      loadInstagramStatusAndData();
    }
    // Intentionally omit function deps to avoid re-creating callbacks each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBrand?.id, daysPeriod]);

  const loadBrands = async () => {
    try {
      const response = await brandApi.getBrands();
      // Brand management is handled by the brand store
      console.log('Brands loaded:', response.brands);
    } catch {
      setError('Failed to load brands');
    }
  };

  const loadAnalytics = async () => {
    if (!selectedBrand?.id) return;

    setLoading(true);
    setError('');

    try {
      const [statsResponse, v2Summary] = await Promise.all([
        httpGet(`/api/analytics/stats/${selectedBrand.id}`),
        analyticsV2.getBrandSummary(selectedBrand.id).catch(() => null),
      ]);

      // Build minimal report from v2 for Overview cards
      const v2 = v2Summary?.data;
      const nextReport: AnalyticsReport = {
        totalPosts: Number(v2?.totalPosts || 0),
        totalImpressions: Number(v2?.totalImpressions || 0),
        totalReach: Number(v2?.reach || 0),
        totalEngagements: Number(v2?.totalEngagement || 0),
        averageEngagementRate: Number(v2?.averageEngagementRate || 0),
        optimalTimes: [],
        topPerformingPosts: [],
        engagementTrends: [],
      };

      setReport(nextReport);
      setSchedulingStats(statsResponse.stats);
    } catch {
      setError('Failed to load analytics data');
    } finally {
      setLoading(false);
    }
  };

  const loadSchedulingData = async () => {
    if (!selectedBrand?.id) return;

    try {
      const response = await httpGet(`/api/analytics/scheduled/${selectedBrand.id}`);
      // Ensure hashtags is always an array to avoid runtime errors
      setScheduledPosts(
        (response.scheduledPosts || []).map((post: any) => ({
          ...post,
          hashtags: Array.isArray(post.hashtags) ? post.hashtags : [],
        }))
      );
    } catch (err) {
      console.error('Failed to load scheduled posts:', err);
    }
  };

  const loadInstagramStatusAndData = async () => {
    if (!selectedBrand?.id) return;
    setIgLoading(true);
    try {
      // Build "overview" from brand summary breakdown[instagram] and account latest series first point
      const summaryRes = await analyticsV2.getBrandSummary(selectedBrand.id).catch(() => null);
      const breakdown = (summaryRes?.data?.breakdown || {}) as Record<string, any>;
      const ig = breakdown['instagram'] || null;
      const seriesRes = await analyticsV2
        .getBrandAccountSeries(selectedBrand.id, '30d')
        .catch(() => null);
      const series = seriesRes?.data?.series || [];
      setIgSeries(series);
      const last = series.length ? series[series.length - 1] : null;
      setIgOverview(
        ig || last
          ? {
              impressions: ig?.impressions || last?.impressions || 0,
              reach: ig?.reach || last?.reach || 0,
              // profile_views is best-effort (may be undefined)
              profile_views: last?.profile_views,
            }
          : null
      );

      // Posts: use top-publications filtered to instagram for now
      const tops = await analyticsV2
        .getBrandTopPublications(selectedBrand.id, 10)
        .catch(() => null);
      const igRows = (tops?.data || []).filter((r: any) => r.platform === 'instagram');
      setIgPosts(
        igRows.map((r: any) => ({
          id: r.publicationId,
          caption: undefined,
          permalink: r.permalink,
          publishedAt: r.publishedAt,
          metrics: r.metrics,
        }))
      );
    } catch (err) {
      console.error('Failed to load Instagram (v2) data:', err);
      setIgOverview(null);
      setIgPosts([]);
    } finally {
      setIgLoading(false);
    }
  };

  const handleCancelPost = async (contentId: string) => {
    try {
      await httpDelete(`/api/analytics/scheduled/${contentId}`);

      // Remove from local state
      setScheduledPosts((prev) => prev.filter((post) => post.id !== contentId));

      // Reload stats
      loadAnalytics();
    } catch {
      setError('Failed to cancel scheduled post');
    }
  };

  const handleReschedulePost = async (contentId: string, newTime: string) => {
    try {
      await httpPut('/api/analytics/reschedule', {
        contentId,
        newTime,
      });

      // Reload scheduling data
      loadSchedulingData();
    } catch {
      setError('Failed to reschedule post');
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  return (
    <div className="min-h-screen p-4 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <PageHeader title="Analytics" description="Performance metrics and scheduling" />

        {error && (
          <div className="mb-6 mt-6">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        )}

        <Tabs
          value={activeTab}
          onValueChange={(val) => {
            setActiveTab(val as 'overview' | 'instagram' | 'scheduling');
            const next = new URLSearchParams(searchParams);
            next.set('tab', val);
            setSearchParams(next, { replace: true });
          }}
          className="mt-6"
        >
          <TabsList className="grid w-full grid-cols-3 md:w-[520px]">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="instagram">Instagram</TabsTrigger>
            <TabsTrigger value="scheduling">Scheduling</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              {selectedBrand && (
                <div className="text-muted-foreground text-sm">
                  Analytics for: <span className="font-medium">{selectedBrand.name}</span>
                </div>
              )}
              <Select value={String(daysPeriod)} onValueChange={(v) => setDaysPeriod(Number(v))}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Select range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {loading && (
              <div className="py-8 text-center">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2"></div>
                <p className="text-muted-foreground mt-2">Loading analytics...</p>
              </div>
            )}

            {report && !loading && (
              <>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border p-6 shadow-sm">
                    <h3 className="text-muted-foreground text-sm font-medium">Total Posts</h3>
                    <p className="text-2xl font-bold">{report.totalPosts}</p>
                  </div>
                  <div className="rounded-lg border p-6 shadow-sm">
                    <h3 className="text-muted-foreground text-sm font-medium">Total Impressions</h3>
                    <p className="text-2xl font-bold">{formatNumber(report.totalImpressions)}</p>
                  </div>
                  <div className="bg-card rounded-lg p-6 shadow-md">
                    <h3 className="text-muted-foreground text-sm font-medium">Total Reach</h3>
                    <p className="text-foreground text-2xl font-bold">
                      {formatNumber(report.totalReach)}
                    </p>
                  </div>
                  <div className="bg-card rounded-lg p-6 shadow-md">
                    <h3 className="text-muted-foreground text-sm font-medium">
                      Avg. Engagement Rate
                    </h3>
                    <p className="text-foreground text-2xl font-bold">
                      {report.averageEngagementRate.toFixed(1)}%
                    </p>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        const res = await analyticsV2.refreshBrandAccounts(selectedBrand!.id);
                        if (res?.success) {
                          toast.success('Account analytics refresh enqueued');
                        } else {
                          toast.message('Refresh requested');
                        }
                      } catch (e: any) {
                        const status = e?.status;
                        const next = e?.data?.nextRefreshAllowed;
                        if (status === 429) {
                          toast.error(
                            next
                              ? `Refresh throttled. Try after ${new Date(next).toLocaleTimeString()}`
                              : 'Refresh throttled. Try later.'
                          );
                        } else {
                          toast.error('Failed to enqueue refresh');
                        }
                      }
                    }}
                  >
                    Refresh Account Analytics
                  </Button>
                </div>

                <V2Charts brandId={selectedBrand!.id} />

                <TopPublications brandId={selectedBrand!.id} />
              </>
            )}

            {!loading && !report && selectedBrand && (
              <div className="py-12 text-center">
                <div className="text-muted-foreground mb-4">
                  <svg
                    className="mx-auto h-12 w-12"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2z"
                    />
                  </svg>
                </div>
                <h3 className="mb-2 text-lg font-medium">No analytics data available</h3>
                <p className="text-muted-foreground">
                  Start posting content to see analytics and insights.
                </p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="instagram" className="space-y-6">
            {igLoading ? (
              <div className="py-8 text-center">
                <div className="border-foreground inline-block h-8 w-8 animate-spin rounded-full border-b-2"></div>
                <p className="text-muted-foreground mt-2">Loading Instagram analytics...</p>
              </div>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <MetricsCard
                    title="Reach (30d)"
                    value={igOverview?.reach || 0}
                    icon={<Users className="h-4 w-4" />}
                  />
                  <MetricsCard
                    title="Impressions (30d)"
                    value={igOverview?.impressions || 0}
                    icon={<Eye className="h-4 w-4" />}
                  />
                  <MetricsCard
                    title="Profile Views"
                    value={igOverview?.profile_views || 0}
                    icon={<Heart className="h-4 w-4" />}
                  />
                </div>

                {igSeries && igSeries.length > 0 ? (
                  <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
                    <TimeSeriesChart
                      title="Reach (Daily)"
                      series={igSeries.map((d) => ({ date: d.date, value: d.reach }))}
                      label="Total reach per day"
                    />
                    <TimeSeriesChart
                      title="Impressions (Daily)"
                      series={igSeries.map((d) => ({ date: d.date, value: d.impressions }))}
                      label="Total impressions per day"
                    />
                  </div>
                ) : null}

                <div className="rounded-lg border p-6 shadow-sm">
                  <h3 className="mb-4 text-lg font-semibold">Top Instagram Posts</h3>
                  {igPosts && igPosts.length > 0 ? (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {igPosts.slice(0, 6).map((post: any) => (
                        <div key={post.id} className="overflow-hidden rounded-lg border">
                          <div className="p-4">
                            <p className="text-muted-foreground mb-2 line-clamp-2 text-sm">
                              {post.caption || '—'}
                            </p>
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-4">
                                <span className="flex items-center gap-1">
                                  <Eye className="h-3 w-3" />
                                  {Number(post.metrics?.impressions || 0).toLocaleString()}
                                </span>
                                <span className="flex items-center gap-1">
                                  <Heart className="h-3 w-3" />
                                  {Number(post.metrics?.engagement || 0).toLocaleString()}
                                </span>
                              </div>
                              {post.permalink ? (
                                <a
                                  href={post.permalink}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="hover:underline"
                                >
                                  View
                                </a>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-muted-foreground py-8 text-center">
                      No posts data available
                    </div>
                  )}
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="scheduling" className="space-y-6">
            {schedulingStats && (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
                <div className="bg-card rounded-lg p-6 shadow-md">
                  <h3 className="text-muted-foreground text-sm font-medium">Scheduled</h3>
                  <p className="text-foreground text-2xl font-bold">{schedulingStats.scheduled}</p>
                </div>
                <div className="bg-card rounded-lg p-6 shadow-md">
                  <h3 className="text-muted-foreground text-sm font-medium">Posted</h3>
                  <p className="text-foreground text-2xl font-bold">{schedulingStats.posted}</p>
                </div>
                <div className="bg-card rounded-lg p-6 shadow-md">
                  <h3 className="text-muted-foreground text-sm font-medium">Failed</h3>
                  <p className="text-foreground text-2xl font-bold">{schedulingStats.failed}</p>
                </div>
                <div className="bg-card rounded-lg p-6 shadow-md">
                  <h3 className="text-muted-foreground text-sm font-medium">Draft</h3>
                  <p className="text-foreground text-2xl font-bold">{schedulingStats.draft}</p>
                </div>
              </div>
            )}
            <SchedulingPanel
              scheduledPosts={scheduledPosts}
              onCancelPost={handleCancelPost}
              onReschedulePost={handleReschedulePost}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function V2Charts({ brandId }: { brandId: string }) {
  const [series, setSeries] = useState<
    Array<{ date: string; impressions: number; reach: number; profile_views: number }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        await analyticsV2.getBrandSummary(brandId).catch(() => null);
        const seriesRes = await analyticsV2.getBrandAccountSeries(brandId, '30d').catch(() => null);
        if (!cancelled && seriesRes?.data?.series) {
          setSeries(seriesRes.data.series);
        }
      } catch {
        if (!cancelled) setErr('Failed to load charts');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  if (loading) return null;
  if (err) return <div className="text-muted-foreground">{err}</div>;
  const reachSeries = series.map((d) => ({ date: d.date, value: d.reach }));
  const impressionsSeries = series.map((d) => ({ date: d.date, value: d.impressions }));
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <TimeSeriesChart title="Reach (Daily)" series={reachSeries} label="Total reach per day" />
      <TimeSeriesChart
        title="Impressions (Daily)"
        series={impressionsSeries}
        label="Total impressions per day"
      />
    </div>
  );
}
function TopPublications({ brandId }: { brandId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await analyticsV2.getBrandTopPublications(brandId, 5);
        if (!cancelled) setRows(res.data || []);
      } catch {
        if (!cancelled) setErr('Failed to load top posts');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  return (
    <div className="bg-card rounded-lg p-6 shadow-md">
      <h3 className="mb-4 text-lg font-semibold">Top Performing Posts</h3>
      {loading ? (
        <div className="text-muted-foreground py-8 text-center">Loading…</div>
      ) : err ? (
        <div className="text-muted-foreground py-8 text-center">{err}</div>
      ) : rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b">
                <th className="text-muted-foreground px-4 py-3 text-left font-medium">
                  Publication
                </th>
                <th className="text-muted-foreground px-4 py-3 text-left font-medium">
                  Impressions
                </th>
                <th className="text-muted-foreground px-4 py-3 text-left font-medium">Reach</th>
                <th className="text-muted-foreground px-4 py-3 text-left font-medium">
                  Engagement
                </th>
                <th className="text-muted-foreground px-4 py-3 text-left font-medium">Eng. Rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.publicationId} className="border-b">
                  <td className="text-foreground max-w-48 truncate px-4 py-3 text-sm">
                    {row.permalink ? (
                      <a
                        href={row.permalink}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline"
                      >
                        {row.platform}:{row.publicationId}
                      </a>
                    ) : (
                      <span>
                        {row.platform}:{row.publicationId}
                      </span>
                    )}
                  </td>
                  <td className="text-foreground px-4 py-3 text-sm">
                    {Number(row.metrics?.impressions || 0).toLocaleString()}
                  </td>
                  <td className="text-foreground px-4 py-3 text-sm">
                    {Number(row.metrics?.reach || 0).toLocaleString()}
                  </td>
                  <td className="text-foreground px-4 py-3 text-sm">
                    {Number(row.metrics?.engagement || 0).toLocaleString()}
                  </td>
                  <td className="text-foreground px-4 py-3 text-sm font-medium">
                    {typeof row.metrics?.engagementRate === 'number'
                      ? Number(row.metrics.engagementRate).toFixed(1)
                      : '0.0'}
                    %
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-muted-foreground py-8 text-center">
          No top performing posts available
        </div>
      )}
    </div>
  );
}
