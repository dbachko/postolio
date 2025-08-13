import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../stores/authStore'
import { useBrandStore } from '../stores/brandStore'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Loader2, Eye, Heart, Users, Instagram } from 'lucide-react'
import { MetricsCard } from '../components/analytics/MetricsCard'
import { EngagementChart } from '../components/analytics/EngagementChart'
import { RefreshControls } from '../components/analytics/RefreshControls'
import { TimeRangeSelector } from '../components/analytics/TimeRangeSelector'
import { apiClient } from '../lib/api'
import { formatDistanceToNow } from 'date-fns'

interface AnalyticsOverview {
  data: {
    followers: number
    impressions: number
    reach: number
    profile_views?: number
    website_clicks?: number
  }
  lastUpdated: string
  fromCache: boolean
}

interface PostPerformance {
  posts: Array<{
    id: string
    caption: string
    impressions: number
    engagement: number
    media_url: string
    posted_at: string
  }>
  lastUpdated: string
}

interface CacheStatus {
  lastUpdated: string | null
  cacheAge: number
  rateLimitRemaining: number
  configured: boolean
}

export default function InstagramAnalytics() {
  const { getToken } = useAuthStore()
  const { selectedBrand } = useBrandStore()
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('7d')
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Fetch analytics overview
  const { data: overview, isLoading: overviewLoading, refetch: refetchOverview } = useQuery<AnalyticsOverview>({
    queryKey: ['instagram-analytics', 'overview', selectedBrand?.id, timeRange],
    queryFn: async () => {
      const token = getToken()
      if (!selectedBrand?.id || !token) throw new Error('Missing brand or auth')
      return apiClient.get(`/api/instagram-analytics/overview/${selectedBrand.id}?timeRange=${timeRange}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
    },
    enabled: !!selectedBrand?.id && !!getToken(),
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  })

  // Fetch posts performance
  const { data: posts, isLoading: postsLoading, refetch: refetchPosts } = useQuery<PostPerformance>({
    queryKey: ['instagram-analytics', 'posts', selectedBrand?.id],
    queryFn: async () => {
      const token = getToken()
      if (!selectedBrand?.id || !token) throw new Error('Missing brand or auth')
      return apiClient.get(`/api/instagram-analytics/posts/${selectedBrand.id}?limit=10`, {
        headers: { Authorization: `Bearer ${token}` }
      })
    },
    enabled: !!selectedBrand?.id && !!getToken(),
    refetchInterval: 10 * 60 * 1000, // Refetch every 10 minutes
  })

  // Fetch cache status
  const { data: status, refetch: refetchStatus } = useQuery<CacheStatus>({
    queryKey: ['instagram-analytics', 'status', selectedBrand?.id],
    queryFn: async () => {
      const token = getToken()
      if (!selectedBrand?.id || !token) throw new Error('Missing brand or auth')
      return apiClient.get(`/api/instagram-analytics/status/${selectedBrand.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
    },
    enabled: !!selectedBrand?.id && !!getToken(),
    refetchInterval: 2 * 60 * 1000, // Refetch every 2 minutes
  })

  const handleRefresh = async () => {
    const token = getToken()
    if (!selectedBrand?.id || !token || isRefreshing) return
    
    setIsRefreshing(true)
    try {
      await apiClient.post(`/api/instagram-analytics/refresh/${selectedBrand.id}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      })
      
      // Refetch all data after refresh
      await Promise.all([
        refetchOverview(),
        refetchPosts(),
        refetchStatus()
      ])
    } catch (error) {
      console.error('Refresh failed:', error)
    } finally {
      setIsRefreshing(false)
    }
  }

  if (!selectedBrand) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">
          <Instagram className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h1 className="text-2xl font-bold mb-4">Instagram Analytics</h1>
          <p className="text-muted-foreground">Please select a brand to view analytics.</p>
        </div>
      </div>
    )
  }

  if (status && !status.configured) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">
          <Instagram className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h1 className="text-2xl font-bold mb-4">Instagram Analytics</h1>
          <Card className="max-w-md mx-auto">
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
                <a href="/instagram">Connect Instagram</a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Instagram className="h-8 w-8" />
            Instagram Analytics
          </h1>
          <p className="text-muted-foreground">
            Insights for {selectedBrand.name}
          </p>
        </div>
        
        <div className="flex items-center gap-4">
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
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>
            Last updated: {status.lastUpdated ? formatDistanceToNow(new Date(status.lastUpdated), { addSuffix: true }) : 'Never'}
          </span>
          <Badge variant={overview?.fromCache ? 'secondary' : 'default'}>
            {overview?.fromCache ? 'Cached' : 'Fresh'}
          </Badge>
          <span>•</span>
          <span>Rate limit: {status.rateLimitRemaining}/200</span>
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
                  <span className="text-sm text-muted-foreground">Loading...</span>
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
              <span className="text-sm text-muted-foreground">Loading posts...</span>
            </div>
          </CardContent>
        </Card>
      ) : posts && posts.posts.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Top Performing Posts</CardTitle>
            <CardDescription>
              Your recent posts with engagement metrics
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {posts.posts.slice(0, 6).map((post) => (
                <Card key={post.id} className="overflow-hidden">
                  {post.media_url && (
                    <div className="aspect-square relative">
                      <img
                        src={post.media_url}
                        alt="Post"
                        className="object-cover w-full h-full"
                      />
                    </div>
                  )}
                  <CardContent className="p-4">
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
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
                        {formatDistanceToNow(new Date(post.posted_at), { addSuffix: true })}
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
            <Instagram className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No posts data available</h3>
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
  )
}