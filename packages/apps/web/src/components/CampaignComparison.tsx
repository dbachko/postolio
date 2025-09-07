import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient, type Campaign } from '../lib/api'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Label } from './ui/label'
import { Checkbox } from './ui/checkbox'
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown, 
  Users, 
  Eye, 
  Heart,
  AlertCircle,
  Loader2,
  X
} from 'lucide-react'

interface Metrics {
  totalImpressions: number
  totalEngagement: number
  reach: number
  averageEngagementRate: number
  totalPosts: number
}

interface ComparisonCampaign {
  id: string
  name: string
  performance: string
  metrics: Metrics
}

interface CampaignComparisonProps {
  campaigns: Campaign[]
  isOpen: boolean
  onClose: () => void
}

export function CampaignComparison({ campaigns, isOpen, onClose }: CampaignComparisonProps) {
  const [selectedCampaigns, setSelectedCampaigns] = useState<string[]>([])
  const [showComparison, setShowComparison] = useState(false)

  // Only fetch comparison when we have selected campaigns and user wants to see results
  const comparisonQuery = useQuery({
    queryKey: ['campaign-comparison', selectedCampaigns],
    queryFn: () => apiClient.compareCampaigns(selectedCampaigns),
    enabled: showComparison && selectedCampaigns.length >= 2
  })

  if (!isOpen) return null

  const handleCampaignToggle = (campaignId: string) => {
    setSelectedCampaigns(prev => 
      prev.includes(campaignId)
        ? prev.filter(id => id !== campaignId)
        : [...prev, campaignId]
    )
  }

  const handleCompare = () => {
    if (selectedCampaigns.length >= 2) {
      setShowComparison(true)
    }
  }

  const handleClose = () => {
    setSelectedCampaigns([])
    setShowComparison(false)
    onClose()
  }

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }

  const getPerformanceColor = (performance: string) => {
    switch (performance) {
      case 'high': return 'text-green-600'
      case 'medium': return 'text-yellow-600'
      case 'low': return 'text-red-600'
      default: return 'text-gray-600'
    }
  }

  const getPerformanceIcon = (performance: string) => {
    switch (performance) {
      case 'high': return <TrendingUp className="w-4 h-4" />
      case 'medium': return <BarChart3 className="w-4 h-4" />
      case 'low': return <TrendingDown className="w-4 h-4" />
      default: return <BarChart3 className="w-4 h-4" />
    }
  }

  // Filter to only show active or completed campaigns that can be compared
  const comparableCampaigns = campaigns.filter(campaign => 
    ['active', 'completed', 'paused'].includes(campaign.status)
  )

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg max-w-6xl w-full max-h-[90vh] overflow-y-auto m-4">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                Compare Campaigns
              </h2>
              <p className="text-gray-600 mt-1">
                Select 2 or more campaigns to compare their performance
              </p>
            </div>
            <Button variant="ghost" onClick={handleClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          {!showComparison ? (
            /* Campaign Selection */
            <div className="space-y-6">
              <div>
                <Label className="text-base font-medium">Select Campaigns to Compare</Label>
                <p className="text-sm text-gray-600 mt-1">
                  Choose at least 2 campaigns that have been launched
                </p>
              </div>

              {comparableCampaigns.length === 0 ? (
                <Card>
                  <CardContent className="py-8">
                    <div className="text-center">
                      <BarChart3 className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                      <h3 className="font-medium text-gray-900 mb-2">No campaigns available for comparison</h3>
                      <p className="text-gray-600">
                        You need at least 2 active or completed campaigns to use the comparison feature.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {comparableCampaigns.map((campaign) => (
                    <Card key={campaign.id} className="cursor-pointer hover:border-blue-300">
                      <CardContent className="p-4">
                        <div className="flex items-center space-x-3">
                          <Checkbox
                            checked={selectedCampaigns.includes(campaign.id)}
                            onCheckedChange={() => handleCampaignToggle(campaign.id)}
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-3">
                              <h4 className="font-medium">{campaign.name}</h4>
                              <Badge 
                                variant={
                                  campaign.status === 'active' ? 'default' :
                                  campaign.status === 'completed' ? 'secondary' :
                                  'outline'
                                }
                              >
                                {campaign.status}
                              </Badge>
                            </div>
                            <p className="text-sm text-gray-600">Brand: {campaign.brandId}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4">
                <Button variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleCompare}
                  disabled={selectedCampaigns.length < 2}
                >
                  Compare {selectedCampaigns.length} Campaign{selectedCampaigns.length !== 1 ? 's' : ''}
                </Button>
              </div>
            </div>
          ) : (
            /* Comparison Results */
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-medium">Comparison Results</h3>
                  <p className="text-sm text-gray-600">
                    Performance comparison for {selectedCampaigns.length} campaigns
                  </p>
                </div>
                <Button variant="outline" onClick={() => setShowComparison(false)}>
                  ← Back to Selection
                </Button>
              </div>

              {comparisonQuery.isLoading ? (
                <Card>
                  <CardContent className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin mr-2" />
                    Analyzing campaigns...
                  </CardContent>
                </Card>
              ) : comparisonQuery.error ? (
                <Card>
                  <CardContent className="py-8">
                    <div className="flex items-center justify-center text-red-600">
                      <AlertCircle className="w-5 h-5 mr-2" />
                      Failed to load comparison data
                    </div>
                  </CardContent>
                </Card>
              ) : comparisonQuery.data?.data ? (
                <>
                  {/* Summary */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Comparison Summary</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div>
                          <p className="text-sm text-gray-600">Best Performing Metric</p>
                          <p className="font-medium capitalize">{comparisonQuery.data.data.summary.bestPerformingMetric}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600">Average Engagement Rate</p>
                          <p className="font-medium">{comparisonQuery.data.data.summary.avgEngagementRate.toFixed(2)}%</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600">Top Performer</p>
                          <p className="font-medium">{comparisonQuery.data.data.topPerformer}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600">Improvement Opportunity</p>
                          <p className="font-medium capitalize">{comparisonQuery.data.data.summary.improvementOpportunity}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Individual Campaign Comparisons */}
                  <div className="grid md:grid-cols-2 gap-6">
                    {(comparisonQuery.data.data.campaigns as ComparisonCampaign[]).map((campaign: ComparisonCampaign) => (
                      <Card key={campaign.id}>
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-lg">{campaign.name}</CardTitle>
                            <div className={`flex items-center gap-1 ${getPerformanceColor(campaign.performance)}`}>
                              {getPerformanceIcon(campaign.performance)}
                              <Badge variant="outline" className={getPerformanceColor(campaign.performance)}>
                                {campaign.performance}
                              </Badge>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div className="text-center">
                                <Eye className="w-5 h-5 mx-auto text-gray-400 mb-1" />
                                <p className="text-sm text-gray-600">Impressions</p>
                                <p className="font-medium">{formatNumber(campaign.metrics.totalImpressions)}</p>
                              </div>
                              <div className="text-center">
                                <Heart className="w-5 h-5 mx-auto text-gray-400 mb-1" />
                                <p className="text-sm text-gray-600">Engagement</p>
                                <p className="font-medium">{formatNumber(campaign.metrics.totalEngagement)}</p>
                              </div>
                              <div className="text-center">
                                <Users className="w-5 h-5 mx-auto text-gray-400 mb-1" />
                                <p className="text-sm text-gray-600">Reach</p>
                                <p className="font-medium">{formatNumber(campaign.metrics.reach)}</p>
                              </div>
                              <div className="text-center">
                                <TrendingUp className="w-5 h-5 mx-auto text-gray-400 mb-1" />
                                <p className="text-sm text-gray-600">Eng. Rate</p>
                                <p className="font-medium">{campaign.metrics.averageEngagementRate.toFixed(2)}%</p>
                              </div>
                            </div>
                            
                            <div className="text-center pt-2 border-t">
                              <p className="text-sm text-gray-600">Total Posts</p>
                              <p className="text-xl font-bold">{campaign.metrics.totalPosts}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
