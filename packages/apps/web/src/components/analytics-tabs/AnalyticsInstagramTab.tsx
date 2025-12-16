import { MetricsCard } from '../analytics/MetricsCard';
import { MultiMetricTimeSeriesChart } from '../analytics/MultiMetricTimeSeriesChart';
import { HashtagAnalysis } from '../analytics/HashtagAnalysis';
import { AudienceInsights } from '../analytics/AudienceInsights';
import { PostsPerformanceTable } from '../analytics/PostsPerformanceTable';
import { Eye, Users } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { PreferredPostingTime } from '@/components/PreferredPostingTime';
import type {
  InstagramHashtag,
  InstagramAudienceInsights,
  InstagramPostDetailed,
} from '@/lib/api/types';

interface AnalyticsInstagramTabProps {
  brandId?: string;
  igLoading: boolean;
  igOverview: {
    followers?: number;
    reach?: number;
    profile_views?: number;
  } | null;
  igSeries: Array<{ date: string; impressions: number; reach: number; profile_views: number }>;
  igHashtags: InstagramHashtag[];
  igAudience: InstagramAudienceInsights | null;
  igPostsDetailed: InstagramPostDetailed[];
  igPostsPagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  onPostsPageChange: (newOffset: number) => void;
}

export function AnalyticsInstagramTab({
  brandId,
  igLoading,
  igOverview,
  igSeries,
  igHashtags,
  igAudience,
  igPostsDetailed,
  igPostsPagination,
  onPostsPageChange,
}: AnalyticsInstagramTabProps) {
  const hasPosts = igPostsDetailed.length > 0;
  const allOverviewZero = (igOverview?.reach ?? 0) === 0 && (igOverview?.profile_views ?? 0) === 0;
  const allPostMetricsZero =
    hasPosts &&
    igPostsDetailed.every(
      (p) =>
        (p.metrics?.impressions || 0) === 0 &&
        (p.metrics?.reach || 0) === 0 &&
        (p.metrics?.engagement || 0) === 0
    );
  const hasSeries = igSeries && igSeries.length > 0;
  const showIngestionNotice =
    !igLoading && hasPosts && allOverviewZero && allPostMetricsZero && !hasSeries;

  return (
    <div className="space-y-6">
      {igLoading ? (
        <div className="py-8 text-center">
          <div className="border-foreground inline-block h-8 w-8 animate-spin rounded-full border-b-2"></div>
          <p className="text-muted-foreground mt-2">Loading Instagram analytics...</p>
        </div>
      ) : (
        <>
          {/* Overview Metrics */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <MetricsCard
              title="Reach (30d)"
              value={igOverview?.reach || 0}
              icon={<Users className="h-4 w-4" />}
            />
            <MetricsCard
              title="Profile Views (30d)"
              value={igOverview?.profile_views || 0}
              icon={<Eye className="h-4 w-4" />}
            />
          </div>

          {showIngestionNotice && (
            <Alert variant="info">
              <AlertTitle>Instagram insights are still syncing</AlertTitle>
              <AlertDescription>
                Your Instagram account is connected and posts are imported, but performance data
                like impressions, reach, and profile views are fetched from Instagram in the
                background. It can take up to about 15 minutes after connecting or syncing posts for
                these metrics to appear.
              </AlertDescription>
            </Alert>
          )}

          {/* Audience Insights */}
          {igAudience?.followerGrowth && (
            <AudienceInsights
              audienceData={{
                demographics: igAudience.demographics,
                demographicsStatus: igAudience.demographicsStatus,
                demographicsError: igAudience.demographicsError,
                followerGrowth: igAudience.followerGrowth,
              }}
              loading={igLoading}
            />
          )}

          {/* Time Series Charts */}
          {igSeries && igSeries.length > 0 ? (
            <MultiMetricTimeSeriesChart
              title="Reach (Daily)"
              series={igSeries.map((d) => ({
                date: d.date,
                metrics: {
                  reach: d.reach,
                },
              }))}
              metrics={[{ key: 'reach', label: 'Reach' }]}
              label="Daily reach"
            />
          ) : null}

          {/* Hashtag Analysis */}
          {igHashtags && igHashtags.length > 0 && (
            <HashtagAnalysis hashtags={igHashtags} loading={igLoading} />
          )}

          {/* Posts Performance Table */}
          <PostsPerformanceTable
            posts={igPostsDetailed}
            loading={igLoading}
            pagination={igPostsPagination}
            onPageChange={onPostsPageChange}
            onPostClick={(contentId) => {
              window.location.href = `/posts/${contentId}`;
            }}
          />

          {/* Preferred Posting Times */}
          {brandId ? <PreferredPostingTime brandId={brandId} /> : null}
        </>
      )}
    </div>
  );
}
