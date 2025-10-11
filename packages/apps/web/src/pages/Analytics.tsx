import { useState, useEffect } from 'react';
import { apiClient } from '../lib/api';
import { PageHeader } from '@/components/PageHeader';
import AnalyticsChart from '../components/AnalyticsChart';
import SchedulingPanel from '../components/SchedulingPanel';
import { useBrandStore } from '../stores/brandStore';

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
  hashtags: string[];
  scheduledTime: string;
  status: string;
}

export default function Analytics() {
  const { selectedBrand } = useBrandStore();
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [schedulingStats, setSchedulingStats] = useState<SchedulingStats | null>(null);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [daysPeriod, setDaysPeriod] = useState(30);

  // Initial brands load on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    loadBrands();
  }, []);

  // Fetch analytics when brand or period changes
  useEffect(() => {
    if (selectedBrand?.id) {
      loadAnalytics();
      loadSchedulingData();
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
      setScheduledPosts(response.scheduledPosts);
    } catch (err) {
      console.error('Failed to load scheduled posts:', err);
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
        <PageHeader
          title="Analytics & Scheduling"
          description="Track performance and manage your posting schedule"
        />

        {error && (
          <div className="mb-6 mt-6 rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700">
            {error}
          </div>
        )}

        <div className="mb-6 mt-6 flex flex-wrap items-center gap-3">
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
            {/* Overview Stats */}
            <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
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

            {/* Scheduling Stats */}
            {schedulingStats && (
              <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-4">
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

            {/* Charts and Data */}
            <div className="mb-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
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

            {/* Top Performing Posts */}
            <div className="mb-8 rounded-lg bg-white p-6 shadow-md">
              <h3 className="mb-4 text-lg font-semibold">Top Performing Posts</h3>
              {report.topPerformingPosts && report.topPerformingPosts.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="px-4 py-3 text-left font-medium text-gray-500">Post ID</th>
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
                            {formatNumber(post.likes + post.comments + post.saves + post.shares)}
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

            {/* Scheduled Posts Panel */}
            <SchedulingPanel
              scheduledPosts={scheduledPosts}
              onCancelPost={handleCancelPost}
              onReschedulePost={handleReschedulePost}
            />
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
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-medium text-gray-900">No analytics data available</h3>
            <p className="text-gray-500">Start posting content to see analytics and insights.</p>
          </div>
        )}
      </div>
    </div>
  );
}
