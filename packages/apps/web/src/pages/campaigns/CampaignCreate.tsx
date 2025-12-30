import { CampaignWizard } from '@/components/campaign-wizard/campaign-wizard';
import { AppEmptyState } from '@/components/app-empty-state';

interface Props {
  brandId?: string;
}

export function CampaignCreate({ brandId }: Props) {
  // If no brand selected, show guidance instead of blank screen
  if (!brandId) {
    return (
      <AppEmptyState
        variant="minimal"
        title="Choose a brand to create a campaign"
        description="Campaign objectives, creative direction, and schedules are personalized per brand."
        actions={[{ label: 'Go to Brands', to: '/brands' }]}
      />
    );
  }
  return <CampaignWizard />;
}
