import { memo } from 'react'
import { CampaignCard } from './CampaignCard'

interface Campaign {
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

interface CampaignsListProps {
  campaigns: Campaign[]
  onViewCampaignDetails: (campaignId: string) => void
  onStartCampaign: (campaignId: string) => void
  onPauseCampaign: (campaignId: string) => void
  onDeleteCampaign: (campaignId: string, campaignName: string) => void
  startCampaignLoading?: boolean
  pauseCampaignLoading?: boolean
  deleteCampaignLoading?: boolean
}

// Status configuration for campaign grouping
const statusConfig = {
  'active': { 
    label: 'Active Campaigns', 
    color: 'bg-green-50 border-green-200', 
    badgeColor: 'bg-green-100 text-green-800', 
    icon: '🟢' 
  },
  'preview': { 
    label: 'Ready to Launch', 
    color: 'bg-blue-50 border-blue-200', 
    badgeColor: 'bg-blue-100 text-blue-800', 
    icon: '🔵' 
  },
  'creating': { 
    label: 'Generating Content', 
    color: 'bg-yellow-50 border-yellow-200', 
    badgeColor: 'bg-yellow-100 text-yellow-800', 
    icon: '🟡' 
  },
  'processing': { 
    label: 'Processing', 
    color: 'bg-orange-50 border-orange-200', 
    badgeColor: 'bg-orange-100 text-orange-800', 
    icon: '🟠' 
  },
  'paused': { 
    label: 'Paused Campaigns', 
    color: 'bg-gray-50 border-gray-200', 
    badgeColor: 'bg-gray-100 text-gray-800', 
    icon: '⚪' 
  },
  'failed': { 
    label: 'Failed Campaigns', 
    color: 'bg-red-50 border-red-200', 
    badgeColor: 'bg-red-100 text-red-800', 
    icon: '🔴' 
  }
}

const CampaignsList = memo(({
  campaigns,
  onViewCampaignDetails,
  onStartCampaign,
  onPauseCampaign,
  onDeleteCampaign,
  startCampaignLoading = false,
  pauseCampaignLoading = false,
  deleteCampaignLoading = false
}: CampaignsListProps) => {
  // Group campaigns by status
  const groupedCampaigns = campaigns.reduce((groups: Record<string, Campaign[]>, campaign: Campaign) => {
    const status = campaign.status || 'unknown'
    if (!groups[status]) {
      groups[status] = []
    }
    groups[status].push(campaign)
    return groups
  }, {})

  return (
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
              {statusCampaigns.map((campaign: Campaign) => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  onViewDetails={onViewCampaignDetails}
                  onStartCampaign={onStartCampaign}
                  onPauseCampaign={onPauseCampaign}
                  onDeleteCampaign={onDeleteCampaign}
                  startCampaignLoading={startCampaignLoading}
                  pauseCampaignLoading={pauseCampaignLoading}
                  deleteCampaignLoading={deleteCampaignLoading}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
})

CampaignsList.displayName = 'CampaignsList'

export { CampaignsList }