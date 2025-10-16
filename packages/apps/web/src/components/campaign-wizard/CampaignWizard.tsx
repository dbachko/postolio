import { useEffect, useState } from 'react';
import { useCampaignWizard, useWizardAutoSave } from '../../hooks/useCampaignWizard';
import { useBrandStore } from '../../stores/brandStore';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { WizardProgress } from './WizardProgress';
import { Step1TypeSelection } from './steps/Step1TypeSelection';
import { Step2CampaignBrief } from './steps/Step2CampaignBrief';
import { Step3StrategyReview } from './steps/Step3StrategyReview';
import { Step4Timeline } from './steps/Step4Timeline';
import { Step5Review } from './steps/Step5Review';
import { Alert, AlertDescription } from '../ui/alert';
import { apiClient } from '../../lib/api';
import { HelpCircle } from 'lucide-react';
import { WizardHelpDialog } from './shared/WizardHelpDialog';

export function CampaignWizard() {
  const currentStep = useCampaignWizard((s) => s.currentStep);
  const brand = useBrandStore((s) => s.selectedBrand);
  const hydrateFromDraft = useCampaignWizard((s) => s.hydrateFromDraft);
  const draftId = useCampaignWizard((s) => s.draftId);
  const reset = useCampaignWizard((s) => s.reset);
  const setBrandId = useCampaignWizard((s) => s.setBrandId);
  const [skipHydration, setSkipHydration] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Keep auto-save active
  useWizardAutoSave();

  // Ensure brand is selected
  useEffect(() => {
    if (!brand) return;
    // Attempt to hydrate from server draft if no local draft present
    (async () => {
      try {
        if (!draftId && !skipHydration) {
          const res = await apiClient.getCampaignDraft(brand.id);
          if (res?.success && res?.draft?.wizardState) {
            hydrateFromDraft({ ...(res.draft.wizardState || {}), draftId: res.draft.id });
          }
        }
      } catch (_) {
        // ignore if not found
      }
    })();
  }, [brand, draftId, skipHydration, hydrateFromDraft]);

  const handleReset = () => {
    setSkipHydration(true);
    reset();
    if (brand) setBrandId(brand.id);
    // Fire-and-forget wizard.reset event
    try {
      if (brand) {
        apiClient.post('/api/analytics/wizard-event', {
          eventName: 'wizard.reset',
          step: 1,
          brandId: brand.id,
        });
      }
    } catch (_e) {
      // ignore telemetry errors
    }
  };

  if (!brand) {
    return (
      <Alert>
        <AlertDescription>Please select a brand to create a campaign.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Create Campaign</CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setHelpOpen(true)}>
                <HelpCircle className="mr-2 h-4 w-4" /> Help
              </Button>
              <Button variant="outline" size="sm" onClick={handleReset}>
                Start Over
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <WizardHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
          <WizardProgress currentStep={currentStep} />
          {currentStep === 1 && <Step1TypeSelection />}
          {currentStep === 2 && <Step2CampaignBrief />}
          {currentStep === 3 && <Step3StrategyReview />}
          {currentStep === 4 && <Step4Timeline />}
          {currentStep === 5 && <Step5Review />}
        </CardContent>
      </Card>
    </div>
  );
}
