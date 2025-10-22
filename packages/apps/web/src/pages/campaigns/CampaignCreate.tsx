import { CampaignWizard } from '@/components/campaign-wizard/CampaignWizard';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

interface Props {
  brandId?: string;
}

export function CampaignCreate({ brandId }: Props) {
  // If no brand selected, show guidance instead of blank screen
  if (!brandId) {
    return (
      <Alert>
        <AlertDescription>
          Please select a brand first to create a campaign.
          <div className="mt-3">
            <Button asChild>
              <Link to="/brands">Go to Brands</Link>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }
  return <CampaignWizard />;
}
