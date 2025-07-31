import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient, type Content } from '../lib/api'
import { ContentCard } from '../components/ContentCard'
import { useBrandStore } from '../stores/brandStore'
import { ArrowRight, Activity, Calendar, Users, TrendingUp, Play, Pause, Settings, Trash2, MoreVertical } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'

export function Content() {
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)
  const [actionMenuOpen, setActionMenuOpen] = useState<string | null>(null)
  const queryClient = useQueryClient()
  
  const { brands, selectedBrand, setBrands, initializeSelectedBrand } = useBrandStore()
  
  const { data: brandsData } = useQuery({
    queryKey: ['brands'],
    queryFn: () => apiClient.getBrands(),
  })

  useEffect(() => {
    if (brandsData?.brands) {
      setBrands(brandsData.brands)
      initializeSelectedBrand(brandsData.brands)
    }
  }, [brandsData, setBrands, initializeSelectedBrand])

  // Close action menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setActionMenuOpen(null)
    if (actionMenuOpen) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [actionMenuOpen])

  const activeBrand = selectedBrand

  // Fetch campaigns for the selected brand
  const { data: campaignsData, isLoading: campaignsLoading } = useQuery({
    queryKey: ['campaigns', activeBrand?.id],
    queryFn: () => activeBrand ? apiClient.listCampaigns(activeBrand.id) : null,
    enabled: !!activeBrand,
  })

  // Fetch detailed campaign data when a campaign is selected
  const { data: selectedCampaignData, isLoading: campaignContentLoading } = useQuery({
    queryKey: ['campaign', selectedCampaignId],
    queryFn: () => selectedCampaignId ? apiClient.getCampaign(selectedCampaignId) : null,
    enabled: !!selectedCampaignId,
  })

  const campaigns = campaignsData?.campaigns || []
  const selectedCampaignContent = selectedCampaignData?.campaign?.content || []

  // Group campaigns by status for TASK-26
  const groupedCampaigns = campaigns.reduce((groups: Record<string, any[]>, campaign: any) => {
    const status = campaign.status || 'unknown'
    if (!groups[status]) {
      groups[status] = []
    }
    groups[status].push(campaign)
    return groups
  }, {})

  // Define status display order and styling
  const statusConfig = {
    'active': { label: 'Active Campaigns', color: 'bg-green-50 border-green-200', badgeColor: 'bg-green-100 text-green-800', icon: '🟢' },
    'preview': { label: 'Ready to Launch', color: 'bg-blue-50 border-blue-200', badgeColor: 'bg-blue-100 text-blue-800', icon: '🔵' },
    'creating': { label: 'Generating Content', color: 'bg-yellow-50 border-yellow-200', badgeColor: 'bg-yellow-100 text-yellow-800', icon: '🟡' },
    'processing': { label: 'Processing', color: 'bg-orange-50 border-orange-200', badgeColor: 'bg-orange-100 text-orange-800', icon: '🟠' },
    'paused': { label: 'Paused Campaigns', color: 'bg-gray-50 border-gray-200', badgeColor: 'bg-gray-100 text-gray-800', icon: '⚪' },
    'failed': { label: 'Failed Campaigns', color: 'bg-red-50 border-red-200', badgeColor: 'bg-red-100 text-red-800', icon: '🔴' }
  }

  const handleCampaignClick = (campaignId: string) => {
    setSelectedCampaignId(selectedCampaignId === campaignId ? null : campaignId)
  }

  // Campaign action mutations for TASK-27
  const startCampaignMutation = useMutation({
    mutationFn: (campaignId: string) => apiClient.startCampaign(campaignId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] })
    },
  })

  const pauseCampaignMutation = useMutation({
    mutationFn: (campaignId: string) => apiClient.updateCampaign(campaignId, { status: 'paused' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] })
    },
  })

  const deleteCampaignMutation = useMutation({
    mutationFn: (campaignId: string) => apiClient.deleteCampaign(campaignId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] })
    },
  })

  const handleStartCampaign = (campaignId: string) => {
    startCampaignMutation.mutate(campaignId)
    setActionMenuOpen(null)
  }

  const handlePauseCampaign = (campaignId: string) => {
    pauseCampaignMutation.mutate(campaignId)
    setActionMenuOpen(null)
  }

  const handleDeleteCampaign = (campaignId: string) => {
    if (confirm('Are you sure you want to delete this campaign? This action cannot be undone.')) {
      deleteCampaignMutation.mutate(campaignId)
    }
    setActionMenuOpen(null)
  }

  if (brands.length === 0) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">No Brands Available</h2>
        <p className="text-gray-600 mb-6">Create a brand first to start generating content.</p>
        <a
          href="/brands"
          className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
        >
          Create Brand
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Campaign Monitoring</h1>
          <p className="text-gray-600">Monitor active campaigns and manage your content pipeline</p>
          {activeBrand && (
            <p className="text-sm text-gray-500 mt-1">Working with: {activeBrand.name}</p>
          )}
        </div>
      </div>

      {/* Autopilot Direction Card */}
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Activity className="w-6 h-6 text-blue-600" />
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Create New Content</h3>
                <p className="text-sm text-gray-600">Use Autopilot to create and schedule campaign content automatically</p>
              </div>
            </div>
          </div>
          <Link
            to="/autopilot"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Go to Autopilot
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* Campaign Dashboard */}
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Campaign Dashboard</h2>
        </div>
        {campaignsLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="text-center py-12">
            <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Active Campaigns</h3>
            <p className="text-gray-500 mb-6">Create your first campaign to start generating and managing content automatically.</p>
            <Link
              to="/autopilot"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Create Campaign
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(statusConfig).map(([status, config]) => {
              const statusCampaigns = groupedCampaigns[status] || []
              if (statusCampaigns.length === 0) return null

              return (
                <div key={status} className={`rounded-lg border p-4 ${config.color}`}>
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-lg">{config.icon}</span>
                    <h3 className="font-semibold text-lg text-gray-900">{config.label}</h3>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${config.badgeColor}`}>
                      {statusCampaigns.length} campaign{statusCampaigns.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  
                  <div className="space-y-3">
                    {statusCampaigns.map((campaign: any) => (
                      <Card key={campaign.id} className="cursor-pointer hover:shadow-md transition-shadow bg-white">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                <h4 className="font-medium text-base">{campaign.name}</h4>
                                <Badge 
                                  variant={
                                    campaign.status === 'active' ? 'default' :
                                    campaign.status === 'preview' ? 'default' :
                                    campaign.status === 'creating' || campaign.status === 'processing' ? 'secondary' :
                                    campaign.status === 'failed' ? 'destructive' :
                                    campaign.status === 'paused' ? 'outline' :
                                    'secondary'
                                  }
                                  className="text-xs"
                                >
                                  {campaign.status === 'creating' ? 'generating...' :
                                   campaign.status === 'preview' ? 'ready to launch' :
                                   campaign.status === 'processing' ? 'processing...' :
                                   campaign.status}
                                </Badge>
                              </div>
                              
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm text-gray-600">
                                <div className="flex items-center gap-2">
                                  <Users className="w-4 h-4" />
                                  <span>{campaign.brand?.name || activeBrand?.name}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Calendar className="w-4 h-4" />
                                  <span>{campaign.contentCount || 0} content</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <TrendingUp className="w-4 h-4" />
                                  <span>{campaign.config?.frequency || 'N/A'}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Activity className="w-4 h-4" />
                                  <span>
                                    {campaign.config?.duration ? 
                                      `${new Date(campaign.config.duration.start).toLocaleDateString()} - ${new Date(campaign.config.duration.end).toLocaleDateString()}` :
                                      'No duration set'
                                    }
                                  </span>
                                </div>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-2">
                              {/* Quick Action Buttons - TASK-27 */}
                              {campaign.status === 'preview' && (
                                <Button
                                  size="sm"
                                  onClick={() => handleStartCampaign(campaign.id)}
                                  disabled={startCampaignMutation.isPending}
                                  className="bg-green-600 hover:bg-green-700 text-white"
                                >
                                  <Play className="w-3 h-3 mr-1" />
                                  {startCampaignMutation.isPending ? 'Starting...' : 'Launch'}
                                </Button>
                              )}
                              
                              {campaign.status === 'active' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handlePauseCampaign(campaign.id)}
                                  disabled={pauseCampaignMutation.isPending}
                                >
                                  <Pause className="w-3 h-3 mr-1" />
                                  {pauseCampaignMutation.isPending ? 'Pausing...' : 'Pause'}
                                </Button>
                              )}
                              
                              {campaign.status === 'paused' && (
                                <Button
                                  size="sm"
                                  onClick={() => handleStartCampaign(campaign.id)}
                                  disabled={startCampaignMutation.isPending}
                                  className="bg-green-600 hover:bg-green-700 text-white"
                                >
                                  <Play className="w-3 h-3 mr-1" />
                                  {startCampaignMutation.isPending ? 'Resuming...' : 'Resume'}
                                </Button>
                              )}

                              {/* More Actions Menu */}
                              <div className="relative">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setActionMenuOpen(actionMenuOpen === campaign.id ? null : campaign.id)}
                                >
                                  <MoreVertical className="w-4 h-4" />
                                </Button>
                                
                                {actionMenuOpen === campaign.id && (
                                  <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-10 min-w-32">
                                    <div className="py-1">
                                      <Link
                                        to={`/autopilot?edit=${campaign.id}`}
                                        className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                        onClick={() => setActionMenuOpen(null)}
                                      >
                                        <Settings className="w-3 h-3" />
                                        Edit Settings
                                      </Link>
                                      <button
                                        onClick={() => handleDeleteCampaign(campaign.id)}
                                        disabled={deleteCampaignMutation.isPending}
                                        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                        {deleteCampaignMutation.isPending ? 'Deleting...' : 'Delete Campaign'}
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                              
                              <button
                                onClick={() => handleCampaignClick(campaign.id)}
                                className="text-blue-600 hover:text-blue-800 font-medium text-sm"
                              >
                                {selectedCampaignId === campaign.id ? 'Hide Content' : 'View Content'}
                              </button>
                            </div>
                          </div>

                          {/* Campaign Content (expandable) */}
                          {selectedCampaignId === campaign.id && (
                            <div className="border-t pt-4 mt-4">
                              {campaignContentLoading ? (
                                <div className="flex items-center justify-center py-8">
                                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
                                </div>
                              ) : selectedCampaignContent.length === 0 ? (
                                <div className="text-center py-8">
                                  <p className="text-gray-500 mb-2">No content generated yet</p>
                                  <p className="text-sm text-gray-400">Content will appear here once the campaign generates posts</p>
                                </div>
                              ) : (
                                <div>
                                  <h4 className="font-medium text-gray-900 mb-3">Campaign Content ({selectedCampaignContent.length})</h4>
                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {selectedCampaignContent.map((content: Content) => (
                                      <ContentCard
                                        key={content.id}
                                        content={content}
                                        brandId={activeBrand!.id}
                                      />
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}