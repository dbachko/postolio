import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBrandStore } from '../stores/brandStore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Loader2, Eye, Heart, Users, Instagram } from 'lucide-react';
import { MetricsCard } from '../components/analytics/MetricsCard';
import { EngagementChart } from '../components/analytics/EngagementChart';
import { RefreshControls } from '../components/analytics/RefreshControls';
import { TimeRangeSelector } from '../components/analytics/TimeRangeSelector';
import { apiClient } from '../lib/api';
import { formatDistanceToNow } from 'date-fns';

interface AnalyticsOverview {
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

interface PostPerformance {
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

interface CacheStatus {
  lastUpdated: string | null;
  cacheAge: number;
  rateLimitRemaining: number;
  configured: boolean;
}

export default function InstagramAnalytics() {
  const { selectedBrand } = useBrandStore();
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('7d');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch analytics overview
  const {
    data: overview,
    isLoading: overviewLoading,
    refetch: refetchOverview,
  } = useQuery<AnalyticsOverview>({
    queryKey: ['instagram-analytics', 'overview', selectedBrand?.id, timeRange],
    queryFn: async () => {
      if (!selectedBrand?.id) throw new Error('Missing brand');
      return apiClient.get(
        `/api/instagram-analytics/overview/${selectedBrand.id}?timeRange=${timeRange}`
      );
    },
    enabled: !!selectedBrand?.id,
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  });

  // Fetch posts performance
  const {
    data: posts,
    isLoading: postsLoading,
    refetch: refetchPosts,
  } = useQuery<PostPerformance>({
    queryKey: ['instagram-analytics', 'posts', selectedBrand?.id],
    queryFn: async () => {
      if (!selectedBrand?.id) throw new Error('Missing brand');
      return apiClient.get(`/api/instagram-analytics/posts/${selectedBrand.id}?limit=10`);
    },
    enabled: !!selectedBrand?.id,
    refetchInterval: 10 * 60 * 1000, // Refetch every 10 minutes
  });

  // Fetch cache status
  const { data: status, refetch: refetchStatus } = useQuery<CacheStatus>({
    queryKey: ['instagram-analytics', 'status', selectedBrand?.id],
    queryFn: async () => {
      if (!selectedBrand?.id) throw new Error('Missing brand');
      return apiClient.get(`/api/instagram-analytics/status/${selectedBrand.id}`);
    },
    enabled: !!selectedBrand?.id,
    refetchInterval: 2 * 60 * 1000, // Refetch every 2 minutes
  });

  const handleRefresh = async () => {
    if (!selectedBrand?.id || isRefreshing) return;

    setIsRefreshing(true);
    try {
      await apiClient.post(`/api/instagram-analytics/refresh/${selectedBrand.id}`, {});

      // Refetch all data after refresh
      await Promise.all([refetchOverview(), refetchPosts(), refetchStatus()]);
    } catch (error) {
      console.error('Refresh failed:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  if (!selectedBrand) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">
          <Instagram className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
          <h1 className="mb-4 text-2xl font-bold">Instagram Analytics</h1>
          <p className="text-muted-foreground">Please select a brand to view analytics.</p>
        </div>
      </div>
    );
  }

  if (status && !status.configured) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">
          <Instagram className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
          <h1 className="mb-4 text-2xl font-bold">Instagram Analytics</h1>
          <Card className="mx-auto max-w-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Instagram className="h-5 w-5" />
                Instagram Not Connected
              </CardTitle>
              <CardDescription>
                Connect your Instagram account to view analytics data for {selectedBrand.name}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <a href="/brands">Connect Instagram</a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-8 px-4 py-8">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold md:text-3xl">
            <Instagram className="h-6 w-6 md:h-8 md:w-8" />
            Instagram Analytics
          </h1>
          <p className="text-muted-foreground">Insights for {selectedBrand.name}</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <TimeRangeSelector value={timeRange} onValueChange={setTimeRange} />
          <RefreshControls
            onRefresh={handleRefresh}
            isRefreshing={isRefreshing}
            lastUpdated={status?.lastUpdated}
            rateLimitRemaining={status?.rateLimitRemaining}
          />
        </div>
      </div>

      {/* Status Bar */}
      {status && (
        <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs sm:text-sm">
          <span className="whitespace-nowrap">
            Last updated:{' '}
            {status.lastUpdated
              ? formatDistanceToNow(new Date(status.lastUpdated), {
                  addSuffix: true,
                })
              : 'Never'}
          </span>
          <Badge variant={overview?.fromCache ? 'secondary' : 'default'} className="text-xs">
            {overview?.fromCache ? 'Cached' : 'Fresh'}
          </Badge>
          <span className="hidden sm:inline">•</span>
          <span className="whitespace-nowrap">Rate limit: {status.rateLimitRemaining}/200</span>
        </div>
      )}

      {/* Overview Metrics */}
      {overviewLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="flex items-center space-x-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-muted-foreground text-sm">Loading...</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : overview ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricsCard
            title="Followers"
            value={overview.data.followers}
            icon={<Users className="h-4 w-4" />}
            trend={0} // We'd need historical data to calculate trend
          />
          <MetricsCard
            title="Impressions"
            value={overview.data.impressions}
            icon={<Eye className="h-4 w-4" />}
            trend={0}
            description={`Past ${timeRange === '7d' ? '7 days' : timeRange === '30d' ? '30 days' : '90 days'}`}
          />
          <MetricsCard
            title="Reach"
            value={overview.data.reach}
            icon={<Heart className="h-4 w-4" />}
            trend={0}
            description={`Past ${timeRange === '7d' ? '7 days' : timeRange === '30d' ? '30 days' : '90 days'}`}
          />
          <MetricsCard
            title="Profile Views"
            value={overview.data.profile_views || 0}
            icon={<Eye className="h-4 w-4" />}
            trend={0}
            description={`Past ${timeRange === '7d' ? '7 days' : timeRange === '30d' ? '30 days' : '90 days'}`}
          />
        </div>
      ) : null}

      {/* Engagement Chart */}
      {posts && !postsLoading && posts.posts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Posts Performance</CardTitle>
            <CardDescription>
              Engagement metrics for your last {posts.posts.length} posts
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EngagementChart data={posts.posts} />
          </CardContent>
        </Card>
      )}

      {/* Posts Grid */}
      {postsLoading ? (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-muted-foreground text-sm">Loading posts...</span>
            </div>
          </CardContent>
        </Card>
      ) : posts && posts.posts.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Top Performing Posts</CardTitle>
            <CardDescription>Your recent posts with engagement metrics</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {posts.posts.slice(0, 6).map((post) => (
                <Card key={post.id} className="overflow-hidden">
                  {post.media_url && (
                    <div className="relative aspect-square">
                      <img src={post.media_url} alt="Post" className="h-full w-full object-cover" />
                    </div>
                  )}
                  <CardContent className="p-4">
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
                      <span className="text-muted-foreground">
                        {formatDistanceToNow(new Date(post.posted_at), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6 text-center">
            <Instagram className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
            <h3 className="mb-2 text-lg font-medium">No posts data available</h3>
            <p className="text-muted-foreground mb-4">
              Start posting content on Instagram to see analytics data.
            </p>
            <Button variant="outline" asChild>
              <a href="/content">Create Content</a>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
