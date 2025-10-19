import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '../lib/api';
import { PageHeader } from '@/components/PageHeader';
import AnalyticsChart from '../components/AnalyticsChart';
import SchedulingPanel from '../components/SchedulingPanel';
import { useBrandStore } from '../stores/brandStore';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MetricsCard } from '../components/analytics/MetricsCard';
import { EngagementChart as IGEngagementChart } from '../components/analytics/EngagementChart';
import { Eye, Heart, Users } from 'lucide-react';

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
interface IGAnalyticsOverview {
  data: {
    followers: number;
    impressions: number;
    reach: number;
    profile_views?: number;
    website_clicks?: number;
  };
  lastUpdated: string;
  fromCache: boolean;
}

interface IGPostPerformance {
  posts: Array<{
    id: string;
    caption: string;
    impressions: number;
    engagement: number;
    media_url: string;
    posted_at: string;
  }>;
  lastUpdated: string;
}

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
  const [igConfigured, setIgConfigured] = useState<boolean | null>(null);
  const [igOverview, setIgOverview] = useState<IGAnalyticsOverview | null>(null);
  const [igPosts, setIgPosts] = useState<IGPostPerformance | null>(null);
  const [igLoading, setIgLoading] = useState(false);

  // Initial brands load on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const response = await apiClient.getBrands();
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
      const [reportResponse, statsResponse] = await Promise.all([
        apiClient.get<{ report: AnalyticsReport }>(
          `/api/analytics/report/${selectedBrand.id}?days=${daysPeriod}`
        ),
        apiClient.get<{ stats: SchedulingStats }>(`/api/analytics/stats/${selectedBrand.id}`),
      ]);

      setReport(reportResponse.report);
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
      const response = await apiClient.get<{ scheduledPosts: ScheduledPost[] }>(
        `/api/analytics/scheduled/${selectedBrand.id}`
      );
      // Ensure hashtags is always an array to avoid runtime errors
      setScheduledPosts(
        (response.scheduledPosts || []).map((post) => ({
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
      // 1) Check IG configuration status first
      const status = await apiClient.get<{ configured: boolean }>(
        `/api/instagram-analytics/status/${selectedBrand.id}`
      );
      if (!status.configured) {
        setIgConfigured(false);
        setIgOverview(null);
        setIgPosts(null);
        return;
      }

      setIgConfigured(true);

      // 2) Fetch analytics data. Failures here should NOT flip configured=false
      try {
        const [overview, posts] = await Promise.all([
          apiClient.get<IGAnalyticsOverview>(
            `/api/instagram-analytics/overview/${selectedBrand.id}?timeRange=30d`
          ),
          apiClient.get<IGPostPerformance>(
            `/api/instagram-analytics/posts/${selectedBrand.id}?limit=10`
          ),
        ]);
        setIgOverview(overview);
        setIgPosts(posts);
      } catch (innerErr) {
        console.error('Failed to load Instagram analytics data:', innerErr);
        // Keep configured=true; just clear data so UI can show a graceful empty state
        setIgOverview(null);
        setIgPosts(null);
      }
    } catch (statusErr) {
      // Only set not-configured if the status check itself fails decisively
      console.error('Instagram analytics status check failed:', statusErr);
      setIgConfigured(false);
      setIgOverview(null);
      setIgPosts(null);
    } finally {
      setIgLoading(false);
    }
  };

  const handleCancelPost = async (contentId: string) => {
    try {
      await apiClient.delete(`/api/analytics/scheduled/${contentId}`);

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
      await apiClient.put('/api/analytics/reschedule', {
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
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <PageHeader title="Analytics" description="Performance metrics and scheduling" />

        {error && (
          <div className="mb-6 mt-6 rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700">
            {error}
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
                <div className="text-sm text-gray-600">
                  Analytics for: <span className="font-medium">{selectedBrand.name}</span>
                </div>
              )}
              <select
                value={daysPeriod}
                onChange={(e) => setDaysPeriod(Number(e.target.value))}
                className="rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500"
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
            </div>

            {loading && (
              <div className="py-8 text-center">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600"></div>
                <p className="mt-2 text-gray-600">Loading analytics...</p>
              </div>
            )}

            {report && !loading && (
              <>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg bg-white p-6 shadow-md">
                    <h3 className="text-sm font-medium text-gray-500">Total Posts</h3>
                    <p className="text-2xl font-bold text-gray-900">{report.totalPosts}</p>
                  </div>
                  <div className="rounded-lg bg-white p-6 shadow-md">
                    <h3 className="text-sm font-medium text-gray-500">Total Impressions</h3>
                    <p className="text-2xl font-bold text-gray-900">
                      {formatNumber(report.totalImpressions)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-white p-6 shadow-md">
                    <h3 className="text-sm font-medium text-gray-500">Total Reach</h3>
                    <p className="text-2xl font-bold text-gray-900">
                      {formatNumber(report.totalReach)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-white p-6 shadow-md">
                    <h3 className="text-sm font-medium text-gray-500">Avg. Engagement Rate</h3>
                    <p className="text-2xl font-bold text-green-600">
                      {report.averageEngagementRate.toFixed(1)}%
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
                  <AnalyticsChart
                    title="Engagement Trends"
                    data={report.engagementTrends || []}
                    type="engagement"
                  />
                  <AnalyticsChart
                    title="Optimal Posting Times"
                    data={report.optimalTimes || []}
                    type="optimal-times"
                  />
                </div>

                <div className="rounded-lg bg-white p-6 shadow-md">
                  <h3 className="mb-4 text-lg font-semibold">Top Performing Posts</h3>
                  {report.topPerformingPosts && report.topPerformingPosts.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full">
                        <thead>
                          <tr className="border-b">
                            <th className="px-4 py-3 text-left font-medium text-gray-500">
                              Post ID
                            </th>
                            <th className="px-4 py-3 text-left font-medium text-gray-500">
                              Impressions
                            </th>
                            <th className="px-4 py-3 text-left font-medium text-gray-500">Reach</th>
                            <th className="px-4 py-3 text-left font-medium text-gray-500">
                              Engagement
                            </th>
                            <th className="px-4 py-3 text-left font-medium text-gray-500">
                              Engagement Rate
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.topPerformingPosts.slice(0, 5).map((post, index) => (
                            <tr key={index} className="border-b">
                              <td className="max-w-32 truncate px-4 py-3 text-sm text-gray-900">
                                {post.postId}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-900">
                                {formatNumber(post.impressions)}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-900">
                                {formatNumber(post.reach)}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-900">
                                {formatNumber(
                                  post.likes + post.comments + post.saves + post.shares
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm font-medium text-green-600">
                                {post.engagementRate.toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="py-8 text-center text-gray-500">
                      No top performing posts available for this period
                    </div>
                  )}
                </div>
              </>
            )}

            {!loading && !report && selectedBrand && (
              <div className="py-12 text-center">
                <div className="mb-4 text-gray-400">
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
                <h3 className="mb-2 text-lg font-medium text-gray-900">
                  No analytics data available
                </h3>
                <p className="text-gray-500">
                  Start posting content to see analytics and insights.
                </p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="instagram" className="space-y-6">
            {igLoading ? (
              <div className="py-8 text-center">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600"></div>
                <p className="mt-2 text-gray-600">Loading Instagram analytics...</p>
              </div>
            ) : igConfigured === false ? (
              <div className="rounded-lg bg-white p-6 text-center shadow-md">
                <h3 className="mb-2 text-lg font-semibold">Instagram Not Connected</h3>
                <p className="mb-4 text-gray-600">
                  Connect your Instagram account to view analytics data for {selectedBrand?.name}.
                </p>
                <a
                  href="/brands"
                  className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
                >
                  Connect Instagram
                </a>
              </div>
            ) : igOverview && igPosts ? (
              <>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <MetricsCard
                    title="Followers"
                    value={igOverview.data.followers}
                    icon={<Users className="h-4 w-4" />}
                  />
                  <MetricsCard
                    title="Impressions"
                    value={igOverview.data.impressions}
                    icon={<Eye className="h-4 w-4" />}
                  />
                  <MetricsCard
                    title="Reach"
                    value={igOverview.data.reach}
                    icon={<Heart className="h-4 w-4" />}
                  />
                  <MetricsCard
                    title="Profile Views"
                    value={igOverview.data.profile_views || 0}
                    icon={<Eye className="h-4 w-4" />}
                  />
                </div>

                {igPosts.posts.length > 0 && (
                  <div className="rounded-lg bg-white p-6 shadow-md">
                    <h3 className="mb-1 text-lg font-semibold">Recent Posts Performance</h3>
                    <p className="mb-4 text-gray-500">
                      Engagement metrics for your last {igPosts.posts.length} posts
                    </p>
                    <IGEngagementChart data={igPosts.posts} />
                  </div>
                )}

                <div className="rounded-lg bg-white p-6 shadow-md">
                  <h3 className="mb-4 text-lg font-semibold">Top Performing Posts</h3>
                  {igPosts.posts && igPosts.posts.length > 0 ? (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {igPosts.posts.slice(0, 6).map((post) => (
                        <div key={post.id} className="overflow-hidden rounded-lg border">
                          {post.media_url && (
                            <div className="relative aspect-square">
                              <img
                                src={post.media_url}
                                alt="Post"
                                className="h-full w-full object-cover"
                              />
                            </div>
                          )}
                          <div className="p-4">
                            <p className="text-muted-foreground mb-2 line-clamp-2 text-sm">
                              {post.caption}
                            </p>
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-4">
                                <span className="flex items-center gap-1">
                                  <Eye className="h-3 w-3" />
                                  {post.impressions.toLocaleString()}
                                </span>
                                <span className="flex items-center gap-1">
                                  <Heart className="h-3 w-3" />
                                  {post.engagement.toLocaleString()}
                                </span>
                              </div>
                              <span className="text-gray-500">
                                {new Date(post.posted_at).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-8 text-center text-gray-500">No posts data available</div>
                  )}
                </div>
              </>
            ) : null}
          </TabsContent>

          <TabsContent value="scheduling" className="space-y-6">
            {schedulingStats && (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
                <div className="rounded-lg bg-white p-6 shadow-md">
                  <h3 className="text-sm font-medium text-gray-500">Scheduled</h3>
                  <p className="text-2xl font-bold text-blue-600">{schedulingStats.scheduled}</p>
                </div>
                <div className="rounded-lg bg-white p-6 shadow-md">
                  <h3 className="text-sm font-medium text-gray-500">Posted</h3>
                  <p className="text-2xl font-bold text-green-600">{schedulingStats.posted}</p>
                </div>
                <div className="rounded-lg bg-white p-6 shadow-md">
                  <h3 className="text-sm font-medium text-gray-500">Failed</h3>
                  <p className="text-2xl font-bold text-red-600">{schedulingStats.failed}</p>
                </div>
                <div className="rounded-lg bg-white p-6 shadow-md">
                  <h3 className="text-sm font-medium text-gray-500">Draft</h3>
                  <p className="text-2xl font-bold text-yellow-600">{schedulingStats.draft}</p>
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
