import type { Campaign } from '@/lib/api';

export interface CampaignEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: Campaign;
  onSaved?: () => void;
}

export type EditableFlags = {
  all: boolean;
  name: boolean;
  dates: boolean;
  frequency: boolean;
  postingTime: boolean;
  themes: boolean;
  style: boolean;
  color: boolean;
  reason: string;
};
