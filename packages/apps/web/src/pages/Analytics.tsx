import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { brand as brandApi, httpGet, analytics } from '../lib/api';
import { PageHeader } from '@/components/PageHeader';
import { useBrandStore } from '../stores/brandStore';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BarChart3 } from 'lucide-react';
import { InstagramIcon } from '@/components/icons/BrandIcons';
import { AnalyticsOverviewTab } from '../components/analytics-tabs/AnalyticsOverviewTab';
import { AnalyticsInstagramTab } from '../components/analytics-tabs/AnalyticsInstagramTab';

interface AnalyticsReport {
  totalPosts: number;
  totalImpressions: number;
  totalReach: number;
  totalEngagement: number;
  averageEngagementRate: number;
  healthScore?: any;
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

export default function Analytics() {
  const { selectedBrand } = useBrandStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState<'overview' | 'instagram'>(
    (['overview', 'instagram'].includes(urlTab) ? urlTab : 'overview') as 'overview' | 'instagram'
  );
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [daysPeriod, setDaysPeriod] = useState(30);

  // Instagram analytics state
  const [igOverview, setIgOverview] = useState<{
    followers?: number;
    reach?: number;
    profile_views?: number;
  } | null>(null);
  const [igSeries, setIgSeries] = useState<
    Array<{ date: string; impressions: number; reach: number; profile_views: number }>
  >([]);
  const [igLoading, setIgLoading] = useState(false);

  // Week 2: Instagram detailed analytics state
  const [igHashtags, setIgHashtags] = useState<any[]>([]);
  const [igAudience, setIgAudience] = useState<any>(null);
  const [igPostsDetailed, setIgPostsDetailed] = useState<any[]>([]);
  const [igPostsPagination, setIgPostsPagination] = useState({
    total: 0,
    limit: 20,
    offset: 0,
    hasMore: false,
  });

  // Week 4: AI Insights state
  const [aiInsights, setAiInsights] = useState<any[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);

  // Week 5: Predictive Analytics state
  const [forecasts, setForecasts] = useState<any>(null);
  const [forecastsLoading, setForecastsLoading] = useState(false);

  // Week 6: Smart Recommendations state
  const [recommendations, setRecommendations] = useState<any>(null);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);

  // Initial brands load on mount
  useEffect(() => {
    loadBrands();
  }, []);

  // Sync active tab with URL param
  useEffect(() => {
    const current = searchParams.get('tab') || 'overview';
    if (current !== activeTab) {
      setActiveTab(
        (['overview', 'instagram'].includes(current) ? current : 'overview') as
          | 'overview'
          | 'instagram'
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Fetch analytics when brand or period changes
  useEffect(() => {
    let cancelled = false;

    const loadAllData = async () => {
      if (!selectedBrand?.id || cancelled) return;

      // Load data with cancellation support
      Promise.all([
        loadAnalytics(cancelled),
        loadAIInsights(cancelled),
        loadForecasts(cancelled),
        loadRecommendations(cancelled),
        loadInstagramStatusAndData(cancelled),
      ]).catch((err) => {
        if (!cancelled) {
          console.error('Failed to load analytics data:', err);
        }
      });
    };

    loadAllData();

    return () => {
      cancelled = true;
    };
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

  const loadAnalytics = async (cancelled = false) => {
    if (!selectedBrand?.id || cancelled) return;

    setLoading(true);
    setError('');

    try {
      let period: '7d' | '30d' | '90d' = '30d';
      if (daysPeriod === 7) period = '7d';
      else if (daysPeriod === 90) period = '90d';

      const window = period;
      const [v2Summary, topPublications, accountSeries] = await Promise.all([
        analytics.getBrandSummary(selectedBrand.id, period).catch(() => null),
        analytics.getBrandTopPublications(selectedBrand.id, 10).catch(() => null),
        analytics.getBrandAccountSeries(selectedBrand.id, window as any).catch(() => null),
      ]);

      if (cancelled) return;

      // Build enhanced report from v2 API
      const v2 = v2Summary?.data;
      const series = accountSeries?.data?.series || [];
      const seriesImpressions = series.reduce(
        (sum: number, p: any) => sum + Number(p.impressions || 0),
        0
      );
      const seriesReach = series.reduce((sum: number, p: any) => sum + Number(p.reach || 0), 0);
      const nextReport: AnalyticsReport = {
        totalPosts: Number(v2?.totalPosts || 0),
        // Fallback to account series sums when summary metrics are missing/zero
        totalImpressions: Number(
          (v2?.totalImpressions ?? 0) > 0 ? v2?.totalImpressions : seriesImpressions
        ),
        totalReach: Number((v2?.reach ?? 0) > 0 ? v2?.reach : seriesReach),
        totalEngagement: Number(v2?.totalEngagement || 0),
        averageEngagementRate: Number(v2?.averageEngagementRate || 0),
        healthScore: v2?.healthScore,
        previousPeriodComparison: v2?.previousPeriodComparison,
        topPosts: topPublications?.data || [],
        topPost: topPublications?.data?.[0]
          ? {
              engagementRate: Number(topPublications.data[0].metrics?.engagementRate || 0),
            }
          : undefined,
      };

      setReport(nextReport);
    } catch {
      if (!cancelled) {
        setError('Failed to load analytics data');
      }
    } finally {
      if (!cancelled) {
        setLoading(false);
      }
    }
  };

  const loadAIInsights = async (cancelled = false) => {
    if (!selectedBrand?.id || cancelled) return;

    setInsightsLoading(true);
    try {
      const response = await httpGet(`/api/ai-insights/${selectedBrand.id}?days=${daysPeriod}`);
      if (cancelled) return;

      setAiInsights(response.data?.insights || []);
    } catch (err) {
      if (!cancelled) {
        console.error('Failed to load AI insights:', err);
        setAiInsights([]);
      }
    } finally {
      if (!cancelled) {
        setInsightsLoading(false);
      }
    }
  };

  const loadForecasts = async (cancelled = false) => {
    if (!selectedBrand?.id || cancelled) return;

    setForecastsLoading(true);
    try {
      const response = await httpGet(`/api/forecasting/${selectedBrand.id}?days=30&historical=90`);
      if (cancelled) return;

      setForecasts(response.data?.forecasts || null);
    } catch (err) {
      if (!cancelled) {
        console.error('Failed to load forecasts:', err);
        setForecasts(null);
      }
    } finally {
      if (!cancelled) {
        setForecastsLoading(false);
      }
    }
  };

  const loadRecommendations = async (cancelled = false) => {
    if (!selectedBrand?.id || cancelled) return;

    setRecommendationsLoading(true);
    try {
      const response = await httpGet(`/api/recommendations/${selectedBrand.id}?days=90`);
      if (cancelled) return;

      setRecommendations(response.data || null);
    } catch (err) {
      if (!cancelled) {
        console.error('Failed to load recommendations:', err);
        setRecommendations(null);
      }
    } finally {
      if (!cancelled) {
        setRecommendationsLoading(false);
      }
    }
  };

  const loadInstagramStatusAndData = async (cancelled = false) => {
    if (!selectedBrand?.id || cancelled) return;
    setIgLoading(true);
    try {
      // Build "overview" from brand summary breakdown[instagram] and account latest series first point
      const summaryRes = await analytics.getBrandSummary(selectedBrand.id).catch(() => null);
      const breakdown = (summaryRes?.data?.breakdown || {}) as Record<string, any>;
      const ig = breakdown['instagram'] || null;
      const seriesRes = await analytics
        .getBrandAccountSeries(selectedBrand.id, '30d')
        .catch(() => null);

      if (cancelled) return;

      const series = seriesRes?.data?.series || [];
      setIgSeries(series);
      const last = series.length ? series[series.length - 1] : null;
      setIgOverview(
        ig || last
          ? {
              reach: ig?.reach || last?.reach || 0,
              // profile_views is best-effort (may be undefined)
              profile_views: last?.profile_views,
            }
          : null
      );

      // Week 2: Fetch Instagram detailed analytics
      const [hashtagsRes, audienceRes, postsRes] = await Promise.all([
        analytics.getBrandHashtags(selectedBrand.id).catch(() => null),
        analytics.getBrandAudience(selectedBrand.id).catch(() => null),
        analytics
          .getBrandPosts(selectedBrand.id, {
            platform: 'instagram',
            sortBy: 'publishedAt',
            order: 'desc',
            limit: 20,
            offset: 0,
          })
          .catch(() => null),
      ]);

      if (cancelled) return;

      setIgHashtags(hashtagsRes?.data?.hashtags || []);
      setIgAudience(audienceRes?.data || null);
      const postsData = postsRes?.data || [];
      const pagination = postsRes?.pagination || {
        total: postsData.length,
        limit: 20,
        offset: 0,
        hasMore: false,
      };
      setIgPostsDetailed(postsData);
      setIgPostsPagination({
        total: pagination.total || postsData.length,
        limit: pagination.limit || 20,
        offset: pagination.offset || 0,
        hasMore: Boolean(pagination.hasMore),
      });
    } catch (err) {
      if (!cancelled) {
        console.error('Failed to load Instagram (v2) data:', err);
        setIgOverview(null);
        setIgHashtags([]);
        setIgAudience(null);
        setIgPostsDetailed([]);
      }
    } finally {
      if (!cancelled) {
        setIgLoading(false);
      }
    }
  };

  const handlePostsPageChange = async (newOffset: number) => {
    if (!selectedBrand?.id) return;
    setIgLoading(true);
    try {
      const postsRes = await analytics.getBrandPosts(selectedBrand.id, {
        platform: 'instagram',
        sortBy: 'publishedAt',
        order: 'desc',
        limit: 20,
        offset: newOffset,
      });
      const postsData = postsRes?.data || [];
      const pagination = postsRes?.pagination || {
        total: postsData.length,
        limit: 20,
        offset: newOffset,
        hasMore: false,
      };
      setIgPostsDetailed(postsData);
      setIgPostsPagination({
        total: pagination.total || postsData.length,
        limit: pagination.limit || 20,
        offset: newOffset,
        hasMore: Boolean(pagination.hasMore),
      });
    } catch (err) {
      console.error('Failed to load posts page:', err);
    } finally {
      setIgLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <div className="w-full">
        <PageHeader title="Analytics" description="Performance metrics and insights" />

        {error && (
          <div className="mt-6 mb-6">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        )}

        {/* Enhanced Tab Navigation */}
        <div className="mb-6 border-b">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setActiveTab('overview');
                const next = new URLSearchParams(searchParams);
                next.set('tab', 'overview');
                setSearchParams(next, { replace: true });
              }}
              className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === 'overview'
                  ? 'border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground border-transparent hover:border-gray-300'
              }`}
            >
              <BarChart3 className="h-4 w-4" />
              <span>Overview</span>
            </button>
            <button
              onClick={() => {
                setActiveTab('instagram');
                const next = new URLSearchParams(searchParams);
                next.set('tab', 'instagram');
                setSearchParams(next, { replace: true });
              }}
              className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === 'instagram'
                  ? 'border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground border-transparent hover:border-gray-300'
              }`}
            >
              <InstagramIcon className="h-4 w-4" aria-hidden="true" />
              <span>Instagram</span>
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div className="space-y-6">
          {activeTab === 'overview' && (
            <AnalyticsOverviewTab
              selectedBrand={selectedBrand}
              report={report}
              loading={loading}
              daysPeriod={daysPeriod}
              setDaysPeriod={setDaysPeriod}
              aiInsights={aiInsights}
              insightsLoading={insightsLoading}
              forecasts={forecasts}
              forecastsLoading={forecastsLoading}
              recommendations={recommendations}
              recommendationsLoading={recommendationsLoading}
            />
          )}

          {activeTab === 'instagram' && (
            <AnalyticsInstagramTab
              brandId={selectedBrand?.id}
              igLoading={igLoading}
              igOverview={igOverview}
              igSeries={igSeries}
              igHashtags={igHashtags}
              igAudience={igAudience}
              igPostsDetailed={igPostsDetailed}
              igPostsPagination={igPostsPagination}
              onPostsPageChange={handlePostsPageChange}
            />
          )}
        </div>
      </div>
    </div>
  );
}
