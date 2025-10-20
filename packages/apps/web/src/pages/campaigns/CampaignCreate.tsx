import { CampaignWizard } from '@/components/campaign-wizard/CampaignWizard';

interface Props {
  brandId?: string;
}

export function CampaignCreate({ brandId }: Props) {
  // Wizard uses its own zustand store; just render when brand present
  if (!brandId) return null;
  return <CampaignWizard />;
}
