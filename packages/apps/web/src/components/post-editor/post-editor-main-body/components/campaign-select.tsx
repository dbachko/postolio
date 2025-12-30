import { Megaphone } from 'lucide-react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Campaign } from '@/lib/api';

interface CampaignSelectProps {
  campaigns: Campaign[];
  isLoadingCampaigns: boolean;
  disabled: boolean;
  selectedCampaign: string | null;
  onSelectCampaign: (campaignId: string) => void;
  selectedCampaignPaused: boolean;
}

export function CampaignSelect({
  campaigns,
  isLoadingCampaigns,
  disabled,
  selectedCampaign,
  onSelectCampaign,
  selectedCampaignPaused,
}: CampaignSelectProps) {
  const campaignSelectItems = (() => {
    if (isLoadingCampaigns) {
      return (
        <SelectItem value="__loading" disabled>
          Loading campaigns...
        </SelectItem>
      );
    }

    if (campaigns.length === 0) {
      return (
        <SelectItem value="__empty" disabled>
          No campaigns found
        </SelectItem>
      );
    }

    return campaigns.map((campaign) => (
      <SelectItem key={campaign.id} value={campaign.id}>
        {campaign.name}
        {campaign.status === 'paused' ? ' (paused)' : ''}
      </SelectItem>
    ));
  })();

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-2">
        <Megaphone className="h-4 w-4" />
        Campaign
      </Label>
      <Select
        value={selectedCampaign || undefined}
        onValueChange={onSelectCampaign}
        disabled={disabled}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select a campaign (optional)" />
        </SelectTrigger>
        <SelectContent>{campaignSelectItems}</SelectContent>
      </Select>
      {selectedCampaignPaused ? (
        <p className="text-muted-foreground text-xs">
          This campaign is paused. You can still save this post as a draft, but you can&apos;t
          schedule it until the campaign is resumed.
        </p>
      ) : null}
    </div>
  );
}
