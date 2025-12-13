import { useEffect, useState, useRef } from 'react';
// import { useLocation } from 'react-router-dom';
import { useBlocker } from 'react-router-dom';
import { useCampaignWizard, useWizardBrandSync } from '../../hooks/useCampaignWizard';
import { useBrandStore } from '../../stores/brandStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { WizardProgress } from './WizardProgress';
import { Step1TypeSelection } from './steps/Step1TypeSelection';
import { Step2CampaignBrief } from './steps/Step2CampaignBrief';
import { Step3ContentThemes } from './steps/Step3ContentThemes';
import { Step4ImagePreferences } from './steps/Step4ImagePreferences';
import { Step5StrategyReview } from './steps/Step5StrategyReview';
import { Step6TimelineReview } from './steps/Step6TimelineReview';
import { Step7Review } from './steps/Step7Review';
import { httpPost } from '../../lib/api';
import { HelpCircle } from 'lucide-react';
import { WizardHelpDialog } from './shared/WizardHelpDialog';
import { AppEmptyState } from '@/components/AppEmptyState';

export function CampaignWizard() {
  // const location = useLocation();
  const currentStep = useCampaignWizard((s) => s.currentStep);
  const brand = useBrandStore((s) => s.selectedBrand);
  const reset = useCampaignWizard((s) => s.reset);
  const setBrandId = useCampaignWizard((s) => s.setBrandId);
  const [helpOpen, setHelpOpen] = useState(false);

  // Use ref to track intentional navigation (e.g., after successful campaign creation)
  // Refs are synchronous, so no race condition with navigation
  const allowNavigationRef = useRef(false);

  // Keep brand ID synced when user switches brand
  useWizardBrandSync();

  // Always start fresh on mount: reset state and set brand
  useEffect(() => {
    reset();
    if (brand) setBrandId(brand.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Determine if wizard has unsaved work to warn on navigation
  const hasUnsavedChanges = useCampaignWizard((s) => {
    return (
      (s.name && s.name.trim().length > 0) ||
      s.campaignType !== null ||
      (Array.isArray(s.goals) && s.goals.length > 0) ||
      !!s.timeline ||
      (Array.isArray(s.themes) && s.themes.length > 0) ||
      (Array.isArray(s.style) && s.style.length > 0) ||
      (s.frequency && s.frequency.trim().length > 0) ||
      s.promotionDetails != null ||
      s.contentPillars != null ||
      (Array.isArray(s.acceptedRecommendations) && s.acceptedRecommendations.length > 0) ||
      s.strategyPredictions != null ||
      s.strategyPredictionsMeta != null ||
      s.strategySchedule != null
    );
  });
  const skipUnsavedWarning = useCampaignWizard((s) => s.skipUnsavedWarning);
  const shouldWarn = hasUnsavedChanges && !skipUnsavedWarning;

  useEffect(() => {
    if (!hasUnsavedChanges && skipUnsavedWarning) {
      useCampaignWizard.setState({ skipUnsavedWarning: false });
    }
  }, [hasUnsavedChanges, skipUnsavedWarning]);

  // Block internal route transitions with a tiny confirm
  function useNavigationConfirm(when: boolean, message: string) {
    const blocker = useBlocker(when);
    useEffect(() => {
      if (blocker.state === 'blocked') {
        const currentAllowRef = useCampaignWizard.getState().allowNavigationRef;
        if (currentAllowRef?.current) {
          blocker.proceed();
          return;
        }
        const proceed = window.confirm(message);
        if (proceed) blocker.proceed();
        else blocker.reset();
      }
    }, [blocker, message]);
  }

  useNavigationConfirm(shouldWarn, "You'll lose your changes. Leave this page?");

  // Expose the allowNavigationRef via the store so Step7 can set it
  useEffect(() => {
    useCampaignWizard.setState({ allowNavigationRef });
  }, []);

  // Warn on browser/tab close or hard navigation
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!shouldWarn) return;
      const currentAllowRef = useCampaignWizard.getState().allowNavigationRef;
      if (currentAllowRef?.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [shouldWarn]);

  // Ensure brand id is set when brand is available (already handled by useWizardBrandSync)

  const handleReset = () => {
    reset();
    if (brand) setBrandId(brand.id);
    try {
      if (brand) {
        httpPost('/api/analytics/wizard-event', {
          eventName: 'wizard.reset',
          step: 1,
          brandId: brand.id,
        });
      }
    } catch (_) {
      /* noop */
    }
  };

  if (!brand) {
    return (
      <AppEmptyState
        variant="minimal"
        title="Pick a brand to launch a campaign"
        description="Campaign briefs, automations, and results stay aligned to the brand you choose."
        actions={[{ label: 'Select Brand', to: '/brands' }]}
      />
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
          <WizardHelpDialog open={helpOpen} onOpenChange={setHelpOpen} currentStep={currentStep} />
          <WizardProgress currentStep={currentStep} />
          {currentStep === 1 && <Step1TypeSelection />}
          {currentStep === 2 && <Step2CampaignBrief />}
          {currentStep === 3 && <Step3ContentThemes />}
          {currentStep === 4 && <Step4ImagePreferences />}
          {currentStep === 5 && <Step5StrategyReview />}
          {currentStep === 6 && <Step6TimelineReview />}
          {currentStep === 7 && <Step7Review />}
        </CardContent>
      </Card>
    </div>
  );
}
