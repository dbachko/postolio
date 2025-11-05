import { useMemo, useState } from 'react';
import { useCampaignWizard } from '../../../hooks/useCampaignWizard';
import { useBrandStore } from '../../../stores/brandStore';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { campaign as campaignApi, httpPost } from '../../../lib/api';
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
      goals: Array.isArray(state.goals) ? state.goals : [],
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
        goals: Array.isArray(state.goals) ? state.goals : undefined,
        seasonalityAssist: state.seasonalityAssist,
      } as const;
      await campaignApi.createCampaign(payload as any);
      // Invalidate campaigns list and brand calendar cache so new placeholders appear immediately
      queryClient.invalidateQueries({ queryKey: ['campaigns', brand.id] });
      queryClient.invalidateQueries({ queryKey: ['calendar', brand.id] });
      // Log funnel event (fire-and-forget)
      try {
        await httpPost('/api/analytics/wizard-event', {
          eventName: 'wizard.launch',
          step: 5,
          brandId: brand.id,
        });
      } catch (_e) {
        // ignore telemetry errors
      }
      toast.success('Campaign created. Generating preview posts...');
      useCampaignWizard.setState({ skipUnsavedWarning: true });
      navigate('/campaigns');
      setTimeout(() => reset(), 0);
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
              <div className="text-muted-foreground">Campaign Type</div>
              <div className="font-medium capitalize">{summary.type.replace('_', ' ')}</div>
            </div>
            <Button variant="outline" onClick={() => setStep(1)}>
              Edit
            </Button>
          </div>
          <div className="bg-muted h-px w-full" />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-muted-foreground">Seasonality Assistance</div>
              <div className="text-muted-foreground">
                Use seasons/holidays in content when relevant
              </div>
            </div>
            <Switch
              checked={summary.seasonalityAssist}
              onCheckedChange={(v) => useCampaignWizard.setState({ seasonalityAssist: v })}
            />
          </div>
          <div className="bg-muted h-px w-full" />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-muted-foreground">Name & Goals</div>
              <div className="font-medium">{summary.name || '—'}</div>
              {summary.goals.length ? (
                <ol className="text-muted-foreground mt-1 space-y-1 pl-0">
                  {summary.goals.map((g, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <Badge
                        variant="secondary"
                        className="min-w-6 justify-center px-2 py-0 text-xs"
                      >
                        {i + 1}
                      </Badge>
                      <span>{g}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="text-muted-foreground">—</div>
              )}
            </div>
            <Button variant="outline" onClick={() => setStep(2)}>
              Edit
            </Button>
          </div>
          <div className="bg-muted h-px w-full" />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-muted-foreground">Timeline & Posting</div>
              <div className="font-medium">
                {summary.timeline?.startDate || '—'} → {summary.timeline?.endDate || '—'}
              </div>
              <div className="text-muted-foreground">
                {summary.frequency || '—'} • {summary.postingTime || '—'}
              </div>
            </div>
            <Button variant="outline" onClick={() => setStep(2)}>
              Edit
            </Button>
          </div>
          <div className="bg-muted h-px w-full" />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-muted-foreground">Themes & Style</div>
              <div className="mb-1 flex flex-wrap gap-1">
                {summary.themes.map((t) => (
                  <Badge key={t} variant="secondary">
                    {t}
                  </Badge>
                ))}
              </div>
              <div className="text-muted-foreground">{summary.style || '—'}</div>
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
