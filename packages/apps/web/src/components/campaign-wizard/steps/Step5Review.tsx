import { useMemo, useState } from 'react';
import { useCampaignWizard } from '../../../hooks/useCampaignWizard';
import { useBrandStore } from '../../../stores/brandStore';
import { Card, CardHeader, CardTitle, CardContent } from '../../ui/card';
import { Button } from '../../ui/button';
import { Switch } from '../../ui/switch';
import { Badge } from '../../ui/badge';
import { Alert, AlertDescription } from '../../ui/alert';
import { apiClient } from '../../../lib/api';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

export function Step5Review() {
  const navigate = useNavigate();
  const brand = useBrandStore((s) => s.selectedBrand);
  const state = useCampaignWizard();
  const { setStep, prevStep, reset } = useCampaignWizard();
  const [isSubmitting, setSubmitting] = useState(false);
  const queryClient = useQueryClient();

  const summary = useMemo(() => {
    return {
      type: state.campaignType || 'custom',
      name: state.name,
      goals: state.goals,
      timeline: state.timeline,
      themes: state.themes,
      style: state.style,
      frequency: state.frequency,
      postingTime: state.postingTime,
      promotionDetails: state.promotionDetails,
      seasonalityAssist: state.seasonalityAssist,
    };
  }, [state]);

  const canLaunch =
    !!brand &&
    !!summary.name &&
    !!summary.timeline?.startDate &&
    !!summary.timeline?.endDate &&
    !!summary.frequency &&
    state.themes.length > 0;

  const handleLaunch = async () => {
    if (!brand) return;
    setSubmitting(true);
    try {
      const payload = {
        name: state.name,
        brandId: brand.id,
        duration: { start: state.timeline!.startDate, end: state.timeline!.endDate },
        frequency: state.frequency!,
        themes: state.themes,
        style: state.style,
        postingTime: state.postingTime,
        campaignType: state.campaignType || 'custom',
        promotionDetails: state.promotionDetails || undefined,
        contentPillars: state.contentPillars || undefined,
        goals: state.goals || undefined,
        seasonalityAssist: state.seasonalityAssist,
      } as const;
      await apiClient.configureCampaign(payload as any);
      // Invalidate campaigns list for this brand so the dashboard shows the new campaign immediately
      queryClient.invalidateQueries({ queryKey: ['campaigns', brand.id] });
      // Log funnel event (fire-and-forget)
      try {
        await apiClient.post('/api/analytics/wizard-event', {
          eventName: 'wizard.launch',
          step: 5,
          brandId: brand.id,
        });
      } catch (_e) {
        // ignore telemetry errors
      }
      toast.success('Campaign created. Generating preview posts...');
      // Clear local and server drafts so next creation starts clean
      try {
        localStorage.removeItem('campaign-wizard-storage');
      } catch (_) {
        /* noop */
      }
      try {
        void apiClient.saveCampaignDraft({
          brandId: brand.id,
          wizardState: {
            currentStep: 1,
            brandId: brand.id,
            name: '',
            campaignType: null,
            goals: '',
            timeline: null,
            themes: [],
            style: '',
            frequency: '',
            postingTime: '12:00',
            priority: 5,
            promotionDetails: null,
            contentPillars: null,
            acceptedRecommendations: [],
          },
        });
      } catch (_) {
        /* noop */
      }
      reset();
      navigate('/campaigns');
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to create campaign');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {!brand && (
        <Alert>
          <AlertDescription>Select a brand to continue.</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Review</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-gray-600">Campaign Type</div>
              <div className="font-medium capitalize">{summary.type.replace('_', ' ')}</div>
            </div>
            <Button variant="outline" onClick={() => setStep(1)}>
              Edit
            </Button>
          </div>
          <div className="h-px w-full bg-gray-200" />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-gray-600">Seasonality Assistance</div>
              <div className="text-gray-600">Use seasons/holidays in content when relevant</div>
            </div>
            <Switch
              checked={summary.seasonalityAssist}
              onCheckedChange={(v) => useCampaignWizard.setState({ seasonalityAssist: v })}
            />
          </div>
          <div className="h-px w-full bg-gray-200" />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-gray-600">Name & Goals</div>
              <div className="font-medium">{summary.name || '—'}</div>
              <div className="text-gray-600">{summary.goals || '—'}</div>
            </div>
            <Button variant="outline" onClick={() => setStep(2)}>
              Edit
            </Button>
          </div>
          <div className="h-px w-full bg-gray-200" />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-gray-600">Timeline & Posting</div>
              <div className="font-medium">
                {summary.timeline?.startDate || '—'} → {summary.timeline?.endDate || '—'}
              </div>
              <div className="text-gray-600">
                {summary.frequency || '—'} • {summary.postingTime || '—'}
              </div>
            </div>
            <Button variant="outline" onClick={() => setStep(2)}>
              Edit
            </Button>
          </div>
          <div className="h-px w-full bg-gray-200" />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-gray-600">Themes & Style</div>
              <div className="mb-1 flex flex-wrap gap-1">
                {summary.themes.map((t) => (
                  <Badge key={t} variant="secondary">
                    {t}
                  </Badge>
                ))}
              </div>
              <div className="text-gray-600">{summary.style || '—'}</div>
            </div>
            <Button variant="outline" onClick={() => setStep(2)}>
              Edit
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={prevStep}>
          Back
        </Button>
        <Button onClick={handleLaunch} disabled={!canLaunch || isSubmitting}>
          {isSubmitting ? 'Creating…' : 'Create Campaign'}
        </Button>
      </div>
    </div>
  );
}
