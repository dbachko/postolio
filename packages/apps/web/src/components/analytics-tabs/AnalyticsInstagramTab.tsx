import { MetricsCard } from '../analytics/MetricsCard';
import { MultiMetricTimeSeriesChart } from '../analytics/MultiMetricTimeSeriesChart';
import { HashtagAnalysis } from '../analytics/HashtagAnalysis';
import { ActivityHeatmap } from '../analytics/ActivityHeatmap';
import { AudienceInsights } from '../analytics/AudienceInsights';
import { PostsPerformanceTable } from '../analytics/PostsPerformanceTable';
import { Eye, Heart, Users } from 'lucide-react';
import type {
  InstagramHashtag,
  InstagramAudienceInsights,
  InstagramPostDetailed,
} from '@/lib/api/types';

interface AnalyticsInstagramTabProps {
  igLoading: boolean;
  igOverview: {
    followers?: number;
    impressions?: number;
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
  igLoading,
  igOverview,
  igSeries,
  igHashtags,
  igAudience,
  igPostsDetailed,
  igPostsPagination,
  onPostsPageChange,
}: AnalyticsInstagramTabProps) {
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

          {/* Audience Insights */}
          {igAudience?.followerGrowth && (
            <AudienceInsights
              audienceData={{
                demographics: igAudience.demographics,
                followerGrowth: igAudience.followerGrowth,
              }}
              loading={igLoading}
            />
          )}

          {/* Activity Heatmap */}
          {igAudience?.activityHeatmap && (
            <ActivityHeatmap
              heatmap={igAudience.activityHeatmap}
              bestTimes={igAudience.bestPostingTimes}
              loading={igLoading}
            />
          )}

          {/* Time Series Charts */}
          {igSeries && igSeries.length > 0 ? (
            <MultiMetricTimeSeriesChart
              title="Reach & Impressions (Daily)"
              series={igSeries.map((d) => ({
                date: d.date,
                metrics: {
                  reach: d.reach,
                  impressions: d.impressions,
                },
              }))}
              metrics={[
                { key: 'reach', label: 'Reach' },
                { key: 'impressions', label: 'Impressions' },
              ]}
              label="Daily reach and impressions"
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
        </>
      )}
    </div>
  );
}
