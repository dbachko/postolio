import { useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../../ui/card';
import { Alert, AlertDescription } from '../../ui/alert';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { useCampaignWizard } from '../../../hooks/useCampaignWizard';
import { useBrandStore } from '../../../stores/brandStore';
import { apiClient } from '../../../lib/api';
import { Loader2, Lightbulb } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../ui/dialog';

export function Step3StrategyReview() {
  const { prevStep, nextStep, contentPillars, updateField } = useCampaignWizard();
  const brand = useBrandStore((s) => s.selectedBrand);
  const wizard = useCampaignWizard();
  const [isGenerating, setIsGenerating] = useState(false);
  const [predictions, setPredictions] = useState<{
    estimatedPosts: number;
    reach: { low: number; high: number };
    engagementRate: number;
  } | null>(null);
  const [schedulePhases, setSchedulePhases] = useState<
    Array<{
      phase: string;
      startOffsetDays: number;
      frequency: 'daily' | 'every2days' | '3weekly';
      rationale: string;
    }>
  >([]);
  const [recommendations, setRecommendations] = useState<string[] | null>(null);
  const [schedulePostingTime, setSchedulePostingTime] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysis, setAnalysis] = useState<{
    objectives: string[];
    keyMessages: string[];
    suggestedPillars: Array<{ name: string; percentage: number; themes: string[] }>;
    schedule: { frequency: 'daily' | 'every2days' | '3weekly'; rationale: string };
  } | null>(null);
  const [pillars, setPillars] = useState<Array<{ name: string; percentage: number }>>(
    contentPillars?.pillars?.map((p) => ({ name: p.name, percentage: p.percentage })) || [
      { name: 'Pillar 1', percentage: 34 },
      { name: 'Pillar 2', percentage: 33 },
      { name: 'Pillar 3', percentage: 33 },
    ]
  );

  const total = useMemo(
    () => pillars.reduce((sum, p) => sum + (Number(p.percentage) || 0), 0),
    [pillars]
  );
  const valid = total === 100 && pillars.every((p) => p.name.trim().length > 0);

  const setName = (idx: number, name: string) => {
    setPillars((prev) => prev.map((p, i) => (i === idx ? { ...p, name } : p)));
  };
  const setPct = (idx: number, pct: number) => {
    const clamped = Math.max(0, Math.min(100, pct));
    setPillars((prev) => prev.map((p, i) => (i === idx ? { ...p, percentage: clamped } : p)));
  };
  const addPillar = () =>
    setPillars((prev) => [...prev, { name: `Pillar ${prev.length + 1}`, percentage: 0 }]);
  const removePillar = (idx: number) => setPillars((prev) => prev.filter((_, i) => i !== idx));
  const onContinue = () => {
    if (!valid) return;
    updateField('contentPillars', { pillars: pillars.map((p) => ({ ...p, themes: [] })) });
    nextStep();
  };

  const canGenerate = useMemo(() => {
    const hasBrand = !!brand;
    const hasTimeline = !!wizard.timeline?.startDate && !!wizard.timeline?.endDate;
    const hasFrequency =
      wizard.frequency === 'daily' ||
      wizard.frequency === 'every2days' ||
      wizard.frequency === '3weekly';
    const hasPostingTime =
      typeof wizard.postingTime === 'string' && /^\d{2}:\d{2}$/.test(wizard.postingTime);
    const hasStyle = !!wizard.style;
    return hasBrand && hasTimeline && hasFrequency && hasPostingTime && hasStyle;
  }, [
    brand,
    wizard.timeline?.startDate,
    wizard.timeline?.endDate,
    wizard.frequency,
    wizard.postingTime,
    wizard.style,
  ]);

  const onGenerate = async () => {
    if (!canGenerate || !brand || !wizard.timeline) return;
    setIsGenerating(true);
    try {
      const res = await apiClient.generateCampaignStrategy({
        brandId: brand.id,
        name: wizard.name || 'Campaign',
        goals: wizard.goals || 'Grow engagement and conversions',
        campaignType: wizard.campaignType || 'custom',
        timeline: { startDate: wizard.timeline.startDate, endDate: wizard.timeline.endDate },
        themes:
          Array.isArray(wizard.themes) && wizard.themes.length > 0
            ? wizard.themes
            : ['awareness', 'product'],
        style: wizard.style || 'modern',
        frequency: wizard.frequency as 'daily' | 'every2days' | '3weekly',
        postingTime: wizard.postingTime,
        promotionDetails: wizard.promotionDetails || undefined,
      });
      if (res?.success) {
        const pillars = res.strategy.contentPillars.pillars.map((p) => ({
          name: p.name,
          percentage: p.percentage,
        }));
        setPillars(pillars);
        updateField('contentPillars', res.strategy.contentPillars);
        setPredictions(res.strategy.predictions);
        setSchedulePhases(res.strategy.schedule.phases);
        setSchedulePostingTime(res.strategy.schedule.postingTime);
        setRecommendations(res.strategy.recommendations || null);
      }
    } catch (e) {
      console.error('generate strategy failed', e);
    } finally {
      setIsGenerating(false);
    }
  };

  const onAnalyzeGoal = async () => {
    if (!brand) return;
    setIsAnalyzing(true);
    try {
      const res = await apiClient.analyzeCampaignGoal({
        brandId: brand.id,
        goal: wizard.goals || 'Grow engagement and conversions',
        themes: wizard.themes,
        campaignType: wizard.campaignType || 'custom',
      });
      if (res?.success) {
        setAnalysis({
          objectives: res.analysis.objectives,
          keyMessages: res.analysis.keyMessages,
          suggestedPillars: res.analysis.suggestedPillars,
          schedule: res.analysis.schedule,
        });
        setAnalysisOpen(true);
      }
    } catch (e) {
      console.error('analyze goal failed', e);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const applyAnalysis = () => {
    if (!analysis) return;
    const mapped = analysis.suggestedPillars.map((p) => ({
      name: p.name,
      percentage: p.percentage,
    }));
    setPillars(mapped);
    updateField('contentPillars', { pillars: analysis.suggestedPillars });
    // Also adopt frequency suggestion if present
    if (analysis.schedule?.frequency) {
      updateField('frequency', analysis.schedule.frequency as 'daily' | 'every2days' | '3weekly');
    }
    setAnalysisOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Alert>
          <AlertDescription>
            Use AI to propose content pillars and predictions. You can edit before continuing.
          </AlertDescription>
        </Alert>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onAnalyzeGoal} disabled={isAnalyzing || !brand}>
            {isAnalyzing ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Analyzing...
              </span>
            ) : (
              'Analyze Goal'
            )}
          </Button>
          <Button onClick={onGenerate} disabled={isGenerating || !canGenerate}>
            {isGenerating ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Generating...
              </span>
            ) : (
              'Generate with AI'
            )}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Content Pillars</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {pillars.map((p, idx) => (
              <div key={idx} className="grid grid-cols-5 items-end gap-2">
                <div className="col-span-3 space-y-1">
                  <Label>Pillar Name</Label>
                  <Input value={p.name} onChange={(e) => setName(idx, e.target.value)} />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label>Percentage</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={p.percentage}
                    onChange={(e) => setPct(idx, Number(e.target.value))}
                  />
                </div>
                {pillars.length > 1 && (
                  <div className="col-span-5">
                    <Button variant="ghost" size="sm" onClick={() => removePillar(idx)}>
                      Remove
                    </Button>
                  </div>
                )}
              </div>
            ))}
            <div className="flex items-center justify-between text-xs text-gray-600">
              <Button variant="outline" size="sm" onClick={addPillar}>
                Add Pillar
              </Button>
              <span className={total !== 100 ? 'text-red-600' : ''}>Total: {total}%</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Posting Schedule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-gray-600">
            {schedulePhases.length === 0 ? (
              <>
                <div className="h-4 w-4/5 animate-pulse rounded bg-gray-200" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200" />
              </>
            ) : (
              <div className="space-y-2">
                {schedulePhases.map((ph, idx) => (
                  <div key={idx} className="rounded border p-2">
                    <div className="font-medium">{ph.phase}</div>
                    <div className="text-xs text-gray-600">
                      Starts day +{ph.startOffsetDays} • {ph.frequency}
                    </div>
                    <div className="text-xs text-gray-600">{ph.rationale}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Predictions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-gray-600">
            {!predictions ? (
              <>
                <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200" />
                <div className="h-4 w-1/3 animate-pulse rounded bg-gray-200" />
              </>
            ) : (
              <div className="text-sm">
                <div>Estimated posts: {predictions.estimatedPosts}</div>
                <div>
                  Reach range: {predictions.reach.low.toLocaleString()} –{' '}
                  {predictions.reach.high.toLocaleString()}
                </div>
                <div>Engagement rate: {(predictions.engagementRate * 100).toFixed(2)}%</div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Strategy Recommendations */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Recommendations</CardTitle>
          <Button
            variant="outline"
            size="sm"
            disabled={!recommendations || recommendations.length === 0}
            onClick={() => {
              // Apply all: accept recs, update themes/frequency/postingTime from strategy
              if (!recommendations) return;
              // Accept all recommendations
              wizard.updateField('acceptedRecommendations', recommendations);
              // Update posting time if provided
              if (schedulePostingTime) {
                wizard.updateField('postingTime', schedulePostingTime);
              }
              // Prefer first phase frequency if exists
              if (schedulePhases.length > 0) {
                const f = schedulePhases[0]?.frequency as
                  | 'daily'
                  | 'every2days'
                  | '3weekly'
                  | undefined;
                if (f) wizard.updateField('frequency', f);
              }
              // Ensure wizard themes include all pillar themes
              const pillarThemes = (wizard.contentPillars?.pillars || [])
                .flatMap((p) => p.themes || [])
                .filter(Boolean) as string[];
              if (pillarThemes.length) {
                const set = new Set([...(wizard.themes || []), ...pillarThemes]);
                wizard.updateField('themes', Array.from(set));
              }
            }}
          >
            Apply All
          </Button>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-gray-700">
          {!recommendations ? (
            <>
              <div className="h-4 w-3/5 animate-pulse rounded bg-gray-200" />
              <div className="h-4 w-2/5 animate-pulse rounded bg-gray-200" />
              <div className="h-4 w-1/3 animate-pulse rounded bg-gray-200" />
            </>
          ) : recommendations.length === 0 ? (
            <div className="text-gray-500">
              No recommendations yet. Generate a strategy to see tips.
            </div>
          ) : (
            <ul className="list-disc pl-5">
              {recommendations.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Tips */}
      <Card>
        <CardContent className="flex items-start gap-3 text-sm text-gray-700">
          <Lightbulb className="mt-0.5 h-4 w-4 text-amber-500" />
          <div>
            <div className="font-medium">Tips</div>
            <p>
              Analyze Goal will pre-fill content pillars and may suggest a cadence. Generate with AI
              uses your current brief to build a schedule and predictions. If you change pillars or
              frequency, click Generate again to update predictions.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Analysis Overlay */}
      <Dialog open={analysisOpen} onOpenChange={setAnalysisOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Goal Analysis</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            {!analysis ? (
              <div className="flex items-center gap-2 text-gray-600">
                <Loader2 className="h-4 w-4 animate-spin" /> Preparing analysis…
              </div>
            ) : (
              <>
                <div>
                  <div className="mb-1 text-gray-600">Objectives</div>
                  <ul className="list-disc pl-5">
                    {analysis.objectives.map((o, i) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="mb-1 text-gray-600">Key Messages</div>
                  <ul className="list-disc pl-5">
                    {analysis.keyMessages.map((k, i) => (
                      <li key={i}>{k}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="mb-1 text-gray-600">Suggested Pillars</div>
                  <div className="space-y-2">
                    {analysis.suggestedPillars.map((p, i) => (
                      <div key={i} className="flex items-center justify-between rounded border p-2">
                        <div className="font-medium">{p.name}</div>
                        <div className="text-gray-600">{p.percentage}%</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnalysisOpen(false)}>
              Close
            </Button>
            <Button onClick={applyAnalysis} disabled={!analysis}>
              Apply Suggestions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex justify-between">
        <Button variant="outline" onClick={prevStep}>
          Back
        </Button>
        <Button onClick={onContinue} disabled={!valid}>
          Continue
        </Button>
      </div>
    </div>
  );
}
