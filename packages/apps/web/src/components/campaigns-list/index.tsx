import { memo } from 'react';
import { CampaignCard } from '@/components/campaign-card';
import type { Campaign } from '@/lib/api';

interface CampaignsListProps {
  campaigns: Campaign[];
  onViewCampaignDetails: (campaignId: string) => void;
}

// Redesigned list: flat, neutral grid of professional cards
export const CampaignsList = memo(({ campaigns, onViewCampaignDetails }: CampaignsListProps) => {
  if (!campaigns || campaigns.length === 0) {
    return <div className="text-muted-foreground text-sm">No campaigns yet</div>;
  }

  // Compact grid layout
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {campaigns.map((campaign: Campaign) => (
        <CampaignCard key={campaign.id} campaign={campaign} onViewDetails={onViewCampaignDetails} />
      ))}
    </div>
  );
});

CampaignsList.displayName = 'CampaignsList';
