import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../lib/api'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/PageHeader'
import { useBrandStore } from '../stores/brandStore'
import { useSchedulingWebSocket } from '../hooks/useSchedulingWebSocket'
import { ConnectionStatus } from '../components/ConnectionStatus'

export function Dashboard() {
  const navigate = useNavigate()
  const { brands, selectedBrand, setBrands, initializeSelectedBrand, setSelectedBrand } = useBrandStore()
  
  // WebSocket connection for real-time updates
  const { connectionStatus, lastUpdate, reconnect, queueSize } = useSchedulingWebSocket({
    enabled: !!selectedBrand,
    onStatusUpdate: (event) => {
      console.log('Real-time status update:', event)
    },
    onConnectionChange: (status) => {
      console.log('Connection status changed:', status)
    },
    onError: (error) => {
      console.error('WebSocket error:', error)
    }
  })

  const { data: brandsData, isLoading: brandsLoading } = useQuery({
    queryKey: ['brands'],
    queryFn: () => apiClient.getBrands(),
  })

  useEffect(() => {
    if (brandsData?.brands) {
      setBrands(brandsData.brands)
      initializeSelectedBrand(brandsData.brands)
    }
  }, [brandsData, setBrands, initializeSelectedBrand])

  const activeBrand = selectedBrand

  // Get comprehensive metrics across all brands
  const { data: allCampaignsData } = useQuery({
    queryKey: ['allCampaigns'],
    queryFn: () => apiClient.listCampaigns(), // Get campaigns for all brands
    enabled: brands.length > 0,
  })

  // Get content metrics from all user's brands
  const { data: contentMetricsData } = useQuery({
    queryKey: ['contentMetrics', brands.map((b) => b.id)],
    queryFn: async () => {
      if (brands.length === 0) return { scheduled: 0, published: 0 }

      // Get content from all brands
      const promises = brands.map((brand) => apiClient.getContentHistory(brand.id))
      const results = await Promise.all(promises)

      const allContent = results.flatMap((result) => result?.content || [])

      return {
        scheduled: allContent.filter(
          (content) =>
            content.status === 'scheduled' &&
            content.scheduledAt &&
            new Date(content.scheduledAt) > new Date()
        ).length,
        published: allContent.filter((content) => content.status === 'published').length,
      }
    },
    enabled: brands.length > 0,
  })

  const allCampaigns = allCampaignsData?.campaigns || []
  const contentMetrics = contentMetricsData || { scheduled: 0, published: 0 }

  // Calculate campaign-focused metrics
  const activeCampaigns = allCampaigns.filter((campaign) => campaign.status === 'active').length
  const scheduledPosts = contentMetrics.scheduled
  const publishedPosts = contentMetrics.published

  // Handle campaign viewing with auto brand-switching
  const handleViewCampaign = (campaign: any) => {
    const campaignBrandId = campaign.brandId || campaign.brand?.id

    // Auto-switch brand if campaign belongs to different brand
    if (campaignBrandId && selectedBrand?.id !== campaignBrandId) {
      const targetBrand = brands.find((brand) => brand.id === campaignBrandId)
      if (targetBrand) {
        setSelectedBrand(targetBrand)
      }
    }

    // Navigate to campaign details
    navigate(`/campaigns/${campaign.id}`)
  }

  if (brandsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    )
  }

  if (brands.length === 0) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-bold text-foreground mb-4">Welcome to Postolio</h2>
        <p className="text-muted-foreground mb-6">
          Get started by creating your first brand to begin generating content.
        </p>
        <Button asChild size="lg">
          <Link to="/brands">Create Your First Brand</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={
          <div className="flex items-center gap-4">
            <span>{activeBrand ? `Managing content for ${activeBrand.name}` : 'No active brand selected'}</span>
            {activeBrand && (
              <ConnectionStatus
                status={connectionStatus}
                lastUpdate={lastUpdate}
                onReconnect={reconnect}
                queueSize={queueSize}
                compact={false}
              />
            )}
          </div>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/brands">Manage Brands</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/campaigns">Campaigns</Link>
            </Button>
            <Button asChild>
              <Link to="/content">Generate Content</Link>
            </Button>
          </>
        }
      />

      {allCampaigns.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>All Campaigns ({allCampaigns.length})</CardTitle>
              <Button variant="link" asChild className="text-primary hover:underline text-sm">
                <Link to="/campaigns">View All →</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {allCampaigns.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground mb-4">No campaigns created yet.</p>
                <Button asChild>
                  <Link to="/campaigns/create">Create Campaign</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {allCampaigns.slice(0, 3).map((campaign) => (
                  <div key={campaign.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <h4 className="font-medium">{campaign.name}</h4>
                      <p className="text-sm text-muted-foreground">
                        Status:{' '}
                        <span
                          className={`capitalize ${campaign.status === 'active' ? 'text-green-600' : 'text-gray-600'}`}
                        >
                          {campaign.status}
                        </span>{' '}
                        • Brand: {campaign.brand?.name}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => handleViewCampaign(campaign)}>
                      View
                    </Button>
                  </div>
                ))}
                {allCampaigns.length > 3 && (
                  <p className="text-sm text-muted-foreground text-center pt-2">
                    And {allCampaigns.length - 3} more campaigns...
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Total Brands</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-primary">{brands.length}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Active Campaigns</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-green-600">{activeCampaigns}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Scheduled Posts</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-blue-600">{scheduledPosts}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Published Posts</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-purple-600">{publishedPosts}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
