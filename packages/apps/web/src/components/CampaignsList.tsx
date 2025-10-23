import { memo } from 'react';
import { CampaignCard } from './CampaignCard';
import type { Campaign } from '../lib/api';

interface CampaignsListProps {
  campaigns: Campaign[];
  onViewCampaignDetails: (campaignId: string) => void;
  onStartCampaign: (campaignId: string) => void;
  onPauseCampaign: (campaignId: string) => void;
  onDeleteCampaign: (campaignId: string, campaignName: string) => void;
  startCampaignLoading?: boolean;
  pauseCampaignLoading?: boolean;
  deleteCampaignLoading?: boolean;
}

// Redesigned list: flat, neutral grid of professional cards
const CampaignsList = memo(
  ({
    campaigns,
    onViewCampaignDetails,
    onStartCampaign,
    onPauseCampaign,
    onDeleteCampaign,
    startCampaignLoading = false,
    pauseCampaignLoading = false,
    deleteCampaignLoading = false,
  }: CampaignsListProps) => {
    if (!campaigns || campaigns.length === 0) {
      return <div className="text-muted-foreground text-sm">No campaigns yet</div>;
    }

    // Full-read cards layout: single column for better readability
    return (
      <div className="grid grid-cols-1 gap-4">
        {campaigns.map((campaign: Campaign) => (
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
    );
  }
);

CampaignsList.displayName = 'CampaignsList';

export { CampaignsList };
