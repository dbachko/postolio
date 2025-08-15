import { memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import { 
  Loader2, Edit, Calendar, TrendingUp, 
  Pause, Play, Trash2, Activity
} from 'lucide-react'
import { formatCompact } from '../lib/timezone'
import { useTimezone } from '../contexts/TimezoneContext'

interface CampaignCardProps {
  campaign: {
    id: string
    name: string
    status: string
    progress?: number
    errorMessage?: string
    content?: { length: number }
    config?: {
      frequency?: string
      duration?: {
        start: string
        end: string
      }
      themes?: string[]
    }
    startedAt?: string
    priority?: number
  }
  onViewDetails: (campaignId: string) => void
  onStartCampaign: (campaignId: string) => void
  onPauseCampaign: (campaignId: string) => void
  onDeleteCampaign: (campaignId: string, campaignName: string) => void
  onEditCampaign: (campaignId: string) => void
  startCampaignLoading?: boolean
  pauseCampaignLoading?: boolean
  deleteCampaignLoading?: boolean
}

const CampaignCard = memo(({ 
  campaign, 
  onViewDetails, 
  onStartCampaign, 
  onPauseCampaign, 
  onDeleteCampaign,
  onEditCampaign,
  startCampaignLoading = false,
  pauseCampaignLoading = false,
  deleteCampaignLoading = false
}: CampaignCardProps) => {
  const { timezone } = useTimezone()
  const navigate = useNavigate()
  
  const getBorderColor = () => {
    switch (campaign.status) {
      case 'active': return '#22c55e'
      case 'preview': return '#3b82f6'
      case 'creating':
      case 'processing': return '#f59e0b'
      case 'failed': return '#ef4444'
      case 'paused': return '#6b7280'
      default: return '#e5e7eb'
    }
  }

  const canDeleteCampaign = () => {
    // Only campaigns with status: draft, preview, creating, failed can be deleted
    const deletableStatuses = ['draft', 'preview', 'creating', 'failed']
    return deletableStatuses.includes(campaign.status)
  }

  const getDeleteTooltip = () => {
    if (canDeleteCampaign()) {
      return 'Delete campaign'
    }
    
    // Provide clear explanations for why campaigns cannot be deleted
    if (campaign.status === 'active') {
      return 'Active campaigns cannot be deleted. They contain published content and serve as historical records. Pause or wait for completion if you want to stop the campaign.'
    }
    
    if (campaign.status === 'paused') {
      return 'Paused campaigns cannot be deleted. They may contain published content and can be resumed. Only campaigns that haven\'t started (draft, preview, creating, failed) can be deleted.'
    }
    
    if (campaign.status === 'completed') {
      return 'Completed campaigns cannot be deleted. They serve as historical records of your marketing activities and contain published content.'
    }
    
    if (campaign.status === 'processing') {
      return 'Campaigns being processed cannot be deleted. Wait for processing to complete or fail before attempting deletion.'
    }
    
    return `Campaigns with status "${campaign.status}" cannot be deleted. Only campaigns that haven't started (draft, preview, creating, failed) can be deleted.`
  }

  const getBadgeVariant = () => {
    switch (campaign.status) {
      case 'active':
      case 'preview': return 'default'
      case 'creating':
      case 'processing': return 'secondary'
      case 'failed': return 'destructive'
      case 'paused': return 'outline'
      default: return 'secondary'
    }
  }

  const getStatusLabel = () => {
    switch (campaign.status) {
      case 'creating': return 'Generating'
      case 'preview': return 'Ready'
      case 'processing': return 'Processing'
      case 'active': return 'Active'
      case 'paused': return 'Paused'
      case 'failed': return 'Failed'
      default: return campaign.status
    }
  }

  const getPriorityLabel = (priority: number) => {
    switch (priority) {
      case 1: return '🔴 Urgent'
      case 2: return '🟠 High'
      case 3: return '🟡 Med-High'
      case 4: return '🟢 Medium'
      case 5: return '🔵 Normal'
      case 6: return '⚪ Low'
      case 7: return '⚫ Very Low'
      default: return `Priority ${priority}`
    }
  }

  const getDurationInDays = () => {
    if (!campaign.config?.duration) return 'No duration'
    const start = new Date(campaign.config.duration.start)
    const end = new Date(campaign.config.duration.end)
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
    return `${days} days`
  }

  return (
    <Card 
      className="group cursor-pointer hover:shadow-lg transition-all duration-200 bg-white border-l-4 hover:border-l-blue-500"
      style={{ borderLeftColor: getBorderColor() }}
      onClick={() => onViewDetails(campaign.id)}
    >
      <CardContent className="p-6">
        <div className="flex-1 min-w-0">
          {/* Header with title and status */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-gray-900 group-hover:text-blue-600 transition-colors truncate">
                {campaign.name}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={getBadgeVariant()} className="text-xs">
                  {getStatusLabel()}
                </Badge>
                
                {/* Content count indicator */}
                {campaign.content && campaign.content.length > 0 && (
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                    {campaign.content.length} posts
                  </span>
                )}
              </div>
            </div>
            
            {/* Quick actions - only show on hover and for relevant states */}
            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              {campaign.status === 'preview' && (
                <Button
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    onStartCampaign(campaign.id)
                  }}
                  disabled={startCampaignLoading}
                  className="bg-green-600 hover:bg-green-700 text-white text-xs px-3 py-1"
                >
                  <Play className="w-3 h-3 mr-1" />
                  Launch
                </Button>
              )}
              
              {campaign.status === 'active' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation()
                    onPauseCampaign(campaign.id)
                  }}
                  disabled={pauseCampaignLoading}
                  className="text-xs px-3 py-1"
                >
                  <Pause className="w-3 h-3 mr-1" />
                  Pause
                </Button>
              )}
              
              {campaign.status === 'paused' && (
                <Button
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    onStartCampaign(campaign.id)
                  }}
                  disabled={startCampaignLoading}
                  className="bg-green-600 hover:bg-green-700 text-white text-xs px-3 py-1"
                >
                  <Play className="w-3 h-3 mr-1" />
                  Resume
                </Button>
              )}

              {/* View in Calendar */}
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation()
                  navigate(`/content?campaigns=${campaign.id}`)
                }}
                className="text-xs px-2 py-1 text-blue-500 hover:text-blue-700"
                title="View in calendar"
              >
                <Calendar className="w-3 h-3" />
              </Button>

              {/* Edit/Delete actions on hover */}
              {(['preview', 'creating', 'failed'].includes(campaign.status)) && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation()
                    onEditCampaign(campaign.id)
                  }}
                  className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700"
                >
                  <Edit className="w-3 h-3" />
                </Button>
              )}
              
              <div className="relative group/delete">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (canDeleteCampaign()) {
                      onDeleteCampaign(campaign.id, campaign.name)
                    }
                  }}
                  disabled={deleteCampaignLoading || !canDeleteCampaign()}
                  title={getDeleteTooltip()}
                  className={`text-xs px-2 py-1 transition-all ${canDeleteCampaign() 
                    ? 'text-red-500 hover:text-red-700 hover:bg-red-50' 
                    : 'text-gray-300 cursor-not-allowed opacity-50 hover:bg-transparent'
                  }`}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
                {/* Show tooltip on hover for disabled state */}
                {!canDeleteCampaign() && (
                  <div className="absolute hidden group-hover/delete:block z-50 bottom-full mb-2 right-0 w-64 p-2 text-xs text-white bg-gray-900 rounded-md shadow-lg">
                    <div className="relative">
                      {getDeleteTooltip()}
                      <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-l-transparent border-r-4 border-r-transparent border-t-4 border-t-gray-900"></div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Progress bar for creating campaigns */}
          {(campaign.status === 'creating' || campaign.status === 'processing') && (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                <span className="text-sm text-gray-600">
                  Generating content... {campaign.progress || 0}%
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                  style={{ width: `${campaign.progress || 0}%` }}
                ></div>
              </div>
            </div>
          )}
          
          {/* Error message for failed campaigns */}
          {campaign.status === 'failed' && campaign.errorMessage && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600">
                <span className="font-medium">Error:</span> {campaign.errorMessage}
              </p>
            </div>
          )}
          
          {/* Campaign details grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <div className="flex items-center gap-2 text-gray-600">
              <TrendingUp className="w-4 h-4 text-gray-400" />
              <span className="font-medium">{campaign.config?.frequency || 'N/A'}</span>
            </div>
            <div className="flex items-center gap-2 text-gray-600">
              <Calendar className="w-4 h-4 text-gray-400" />
              <span>{getDurationInDays()}</span>
            </div>
            {campaign.startedAt && (
              <div className="flex items-center gap-2 text-gray-600">
                <Activity className="w-4 h-4 text-gray-400" />
                <span>Started {formatCompact(campaign.startedAt, 'MMM d', timezone)}</span>
              </div>
            )}
            {campaign.priority && campaign.priority !== 5 && (
              <div className="flex items-center gap-2 text-gray-600">
                <span className="text-xs">
                  {getPriorityLabel(campaign.priority)}
                </span>
              </div>
            )}
          </div>

          {/* Themes preview */}
          {campaign.config?.themes && campaign.config.themes.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <div className="flex flex-wrap gap-1">
                {campaign.config.themes.slice(0, 3).map((theme: string, index: number) => (
                  <span 
                    key={index} 
                    className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-full"
                  >
                    {theme}
                  </span>
                ))}
                {campaign.config.themes.length > 3 && (
                  <span className="text-xs text-gray-500 px-2 py-1">
                    +{campaign.config.themes.length - 3} more
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
})

CampaignCard.displayName = 'CampaignCard'

export { CampaignCard }