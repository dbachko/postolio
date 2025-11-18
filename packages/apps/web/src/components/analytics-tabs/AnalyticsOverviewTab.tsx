import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatNumber, formatPercent } from '@/utils/formatNumber';
import { Eye, Heart, Users, FileText, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { analyticsV2, content as contentApi } from '../../lib/api';
import { BrandHealthScore as BrandHealthScoreComponent } from '../analytics/BrandHealthScore';
import { KPICard } from '../analytics/KPICard';
import { TopPostsGrid } from '../analytics/TopPostsGrid';
import { InsightsPanel } from '../analytics/InsightsPanel';
import { ForecastCharts } from '../analytics/ForecastCharts';
import { GrowthProjectionCard } from '../analytics/GrowthProjectionCard';
import { RecommendationsPanel } from '../analytics/RecommendationsPanel';
import { PostingScheduleOptimizer } from '../analytics/PostingScheduleOptimizer';
import { MultiMetricTimeSeriesChart } from '../analytics/MultiMetricTimeSeriesChart';
import type {
  AIInsight,
  ApiForecastsData,
  RecommendationsData,
  BrandHealthScore,
} from '@/lib/api/types';

interface AnalyticsReport {
  totalPosts: number;
  totalImpressions: number;
  totalReach: number;
  totalEngagement: number;
  averageEngagementRate: number;
  healthScore?: BrandHealthScore;
  previousPeriodComparison?: {
    totalPosts?: { current: number; previous: number; change: number };
    impressions?: { current: number; previous: number; change: number };
    reach?: { current: number; previous: number; change: number };
    engagement?: { current: number; previous: number; change: number };
    engagementRate?: { current: number; previous: number; change: number };
  };
  topPosts?: Array<{
    publicationId: string;
    contentId: string;
    platform: string;
    permalink?: string;
    publishedAt?: string;
    metrics: {
      impressions: number;
      reach: number;
      likes: number;
      comments: number;
      saves: number;
      shares: number;
      engagement: number;
      engagementRate: number;
    };
  }>;
  topPost?: {
    engagementRate: number;
  };
}

interface AnalyticsOverviewTabProps {
  selectedBrand: { id: string; name: string } | null;
  report: AnalyticsReport | null;
  loading: boolean;
  daysPeriod: number;
  setDaysPeriod: (days: number) => void;
  aiInsights: AIInsight[];
  insightsLoading: boolean;
  forecasts: ApiForecastsData | null;
  forecastsLoading: boolean;
  recommendations: RecommendationsData | null;
  recommendationsLoading: boolean;
}

export function AnalyticsOverviewTab({
  selectedBrand,
  report,
  loading,
  daysPeriod,
  setDaysPeriod,
  aiInsights,
  insightsLoading,
  forecasts,
  forecastsLoading,
  recommendations,
  recommendationsLoading,
}: AnalyticsOverviewTabProps) {
  const [showScheduleOptimizer, setShowScheduleOptimizer] = useState(false);
  const [topPostThumbs, setTopPostThumbs] = useState<Record<string, string>>({});
  const hasPosts = (report?.totalPosts || 0) > 0;
  const hasPostMetrics = Boolean(report?.topPosts && report.topPosts.length > 0);
  const showIngestionNotice = hasPosts && !hasPostMetrics;

  // Best-effort: load thumbnails for top posts lacking a thumbnailUrl
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const posts = report?.topPosts || [];
      const toFetch = posts
        .filter((p: any) => !p.thumbnailUrl && !topPostThumbs[p.contentId])
        .slice(0, 10);
      if (toFetch.length === 0) return;
      const results: Record<string, string> = {};
      await Promise.all(
        toFetch.map(async (p: any) => {
          try {
            const res = await contentApi.getPostDetail(p.contentId);
            const raw = (res as any)?.data ?? res;
            const url = raw?.imageUrl;
            if (url) results[p.contentId] = url;
          } catch {
            // ignore
          }
        })
      );
      if (!cancelled && Object.keys(results).length) {
        setTopPostThumbs((prev) => ({ ...prev, ...results }));
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [report?.topPosts, topPostThumbs]);

  return (
    <div className="space-y-6">
      {/* Screen reader loading announcement */}
      {loading && (
        <div role="status" aria-live="polite" className="sr-only">
          Loading analytics data...
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {selectedBrand && (
          <div className="text-muted-foreground text-sm">
            Analytics for: <span className="font-medium">{selectedBrand.name}</span>
          </div>
        )}
        <Select
          value={String(daysPeriod)}
          onValueChange={(v) => {
            const period = Number(v);
            // Validate period is one of the allowed values
            if ([7, 30, 90].includes(period)) {
              setDaysPeriod(period);
            } else {
              console.error(`Invalid analytics period: ${v}. Must be 7, 30, or 90 days.`);
            }
          }}
        >
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

      {report && !loading && (
        <>
          {showIngestionNotice && (
            <Alert variant="info">
              <AlertTitle>Analytics are still syncing</AlertTitle>
              <AlertDescription>
                Your social accounts are connected and posts are imported, but detailed analytics
                like impressions, reach, and engagement come from the platform insights APIs and are
                fetched in the background. It can take up to about 15 minutes after connecting or
                running a sync for these metrics to appear here.
              </AlertDescription>
            </Alert>
          )}

          {/* Brand Health Score - Hero Section */}
          <BrandHealthScoreComponent healthScore={report.healthScore} loading={loading} />

          {/* KPI Summary Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <KPICard
              title="Total Posts"
              value={report.totalPosts}
              change={report.previousPeriodComparison?.totalPosts?.change}
              icon={<FileText className="h-5 w-5" />}
              loading={loading}
            />
            <KPICard
              title="Views"
              value={formatNumber(report.totalImpressions)}
              change={report.previousPeriodComparison?.impressions?.change}
              icon={<Eye className="h-5 w-5" />}
              loading={loading}
            />
            <KPICard
              title="Reach"
              value={formatNumber(report.totalReach)}
              change={report.previousPeriodComparison?.reach?.change}
              icon={<Users className="h-5 w-5" />}
              loading={loading}
            />
            <KPICard
              title="Engagement"
              value={formatNumber(report.totalEngagement)}
              change={report.previousPeriodComparison?.engagement?.change}
              icon={<Heart className="h-5 w-5" />}
              loading={loading}
            />
            <KPICard
              title="Engagement Rate"
              value={formatPercent(report.averageEngagementRate)}
              change={report.previousPeriodComparison?.engagementRate?.change}
              icon={<TrendingUp className="h-5 w-5" />}
              loading={loading}
            />
            <KPICard
              title="Best Post"
              value={report.topPost ? formatPercent(report.topPost.engagementRate) : 'N/A'}
              icon={<Heart className="h-5 w-5" />}
              loading={loading}
            />
          </div>

          {/* AI Insights Panel */}
          <InsightsPanel insights={aiInsights} loading={insightsLoading} />

          {/* Smart Recommendations */}
          <div
            className={`grid grid-cols-1 gap-6 ${showScheduleOptimizer ? 'lg:grid-cols-2' : ''}`}
          >
            <RecommendationsPanel
              recommendations={recommendations || undefined}
              loading={recommendationsLoading}
              onViewSchedule={() => setShowScheduleOptimizer(!showScheduleOptimizer)}
            />
            {showScheduleOptimizer && (
              <PostingScheduleOptimizer
                postingTimes={recommendations?.postingTimes}
                loading={recommendationsLoading}
              />
            )}
          </div>

          {/* Predictive Analytics */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Forecast Charts - Takes 2 columns */}
            <div className="lg:col-span-2">
              <ForecastCharts
                forecasts={
                  forecasts
                    ? {
                        engagement: forecasts.engagement,
                        followerGrowth: forecasts.followerGrowth
                          ? {
                              ...forecasts.followerGrowth,
                              expectedGrowth:
                                (((forecasts.followerGrowth.predicted[
                                  forecasts.followerGrowth.predicted.length - 1
                                ]?.predicted || forecasts.followerGrowth.current) -
                                  forecasts.followerGrowth.current) /
                                  (forecasts.followerGrowth.current || 1)) *
                                100,
                              expectedFollowers:
                                forecasts.followerGrowth.predicted[
                                  forecasts.followerGrowth.predicted.length - 1
                                ]?.predicted || forecasts.followerGrowth.current,
                            }
                          : undefined,
                        engagementRate: forecasts.engagement,
                        reach: forecasts.reach
                          ? {
                              ...forecasts.reach,
                              expectedReach:
                                forecasts.reach.predicted[forecasts.reach.predicted.length - 1]
                                  ?.predicted || forecasts.reach.current,
                            }
                          : undefined,
                      }
                    : undefined
                }
                loading={forecastsLoading}
              />
            </div>

            {/* Growth Projections - Takes 1 column */}
            <div className="lg:col-span-1">
              <GrowthProjectionCard
                followerGrowth={
                  forecasts?.followerGrowth
                    ? {
                        current: forecasts.followerGrowth.current,
                        predicted:
                          forecasts.followerGrowth.predicted[
                            forecasts.followerGrowth.predicted.length - 1
                          ]?.predicted || forecasts.followerGrowth.current,
                        growth:
                          (((forecasts.followerGrowth.predicted[
                            forecasts.followerGrowth.predicted.length - 1
                          ]?.predicted || forecasts.followerGrowth.current) -
                            forecasts.followerGrowth.current) /
                            (forecasts.followerGrowth.current || 1)) *
                          100,
                        trend: forecasts.followerGrowth.trend,
                        confidence: forecasts.followerGrowth.confidence,
                      }
                    : undefined
                }
                engagementGrowth={
                  forecasts?.engagement
                    ? {
                        current: forecasts.engagement.current,
                        predicted:
                          forecasts.engagement.predicted[forecasts.engagement.predicted.length - 1]
                            ?.predicted || forecasts.engagement.current,
                        growth:
                          forecasts.engagement.current > 0
                            ? (((forecasts.engagement.predicted[
                                forecasts.engagement.predicted.length - 1
                              ]?.predicted || forecasts.engagement.current) -
                                forecasts.engagement.current) /
                                forecasts.engagement.current) *
                              100
                            : 0,
                        trend: forecasts.engagement.trend,
                        confidence: forecasts.engagement.confidence,
                      }
                    : undefined
                }
                loading={forecastsLoading}
                timeframe={30}
              />
            </div>
          </div>

          {/* Performance Charts */}
          {selectedBrand && <V2Charts brandId={selectedBrand.id} />}

          {/* Top Posts Grid */}
          <TopPostsGrid
            posts={(report.topPosts || []).map((p: any) => ({
              ...p,
              thumbnailUrl: p.thumbnailUrl || p.imageUrl || topPostThumbs[p.contentId],
            }))}
            loading={loading}
            onPostClick={(postId) => {
              window.location.href = `/posts/${postId}`;
            }}
          />

          {/* Refresh Button */}
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (!selectedBrand) return;
                try {
                  const res = await analyticsV2.refreshBrandAccounts(selectedBrand.id);
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
        </>
      )}

      {!loading && !report && selectedBrand && (
        <div className="py-12 text-center" role="status">
          <div className="text-muted-foreground mb-4">
            <svg
              className="mx-auto h-12 w-12"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
              role="img"
              aria-label="No data chart icon"
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
    </div>
  );
}

// V2Charts helper component
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
  return (
    <MultiMetricTimeSeriesChart
      title="Reach & Views (Daily)"
      series={series.map((d) => ({
        date: d.date,
        metrics: {
          reach: d.reach,
          impressions: d.impressions,
        },
      }))}
      metrics={[
        { key: 'reach', label: 'Reach' },
        { key: 'impressions', label: 'Views' },
      ]}
      label="Daily reach and impressions"
    />
  );
}
