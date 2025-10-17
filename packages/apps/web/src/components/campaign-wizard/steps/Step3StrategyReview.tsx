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
import { WizardHelpDialog } from '../shared/WizardHelpDialog';
import { toast } from 'sonner';
import { Badge } from '../../ui/badge';
import { useNavigate } from 'react-router-dom';

export function Step3StrategyReview() {
  const navigate = useNavigate();
  const { prevStep, nextStep, contentPillars, updateField } = useCampaignWizard();
  const brand = useBrandStore((s) => s.selectedBrand);
  const wizard = useCampaignWizard();
  const [isGenerating, setIsGenerating] = useState(false);
  const [predictions, setPredictions] = useState<{
    estimatedPosts: number;
    reach: { low: number; high: number };
    engagementRate: number;
  } | null>(wizard.strategyPredictions || null);
  const [predictionsMeta, setPredictionsMeta] = useState<{
    basis: 'historical' | 'heuristic';
    samples: { engagement: number; reach: number };
  } | null>(wizard.strategyPredictionsMeta || null);
  const [schedulePhases, setSchedulePhases] = useState<
    Array<{
      phase: string;
      startOffsetDays: number;
      frequency: 'daily' | 'every2days' | '3weekly';
      rationale: string;
    }>
  >(wizard.strategySchedule?.phases || []);
  // Auto-apply optimizations instead of showing recommendations
  const [optimizationNoteVisible, setOptimizationNoteVisible] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [optChanges, setOptChanges] = useState<{
    postingTime?: { prev: string | null; next: string | null };
    frequency?: {
      prev: string; // wizard frequency can be custom
      next: 'daily' | 'every2days' | '3weekly';
    };
    themes?: { prev: string[]; next: string[]; added: string[] };
  } | null>(null);
  const [_schedulePostingTime, setSchedulePostingTime] = useState<string | null>(
    wizard.strategySchedule?.postingTime || null
  );
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysis, setAnalysis] = useState<{
    objectives: string[];
    keyMessages: string[];
    suggestedPillars: Array<{ name: string; percentage: number; themes: string[] }>;
    schedule: { frequency: 'daily' | 'every2days' | '3weekly'; rationale: string };
  } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
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
    // Style is optional for generation; we will default to 'modern' when absent
    return hasBrand && hasTimeline && hasFrequency && hasPostingTime;
  }, [
    brand,
    wizard.timeline?.startDate,
    wizard.timeline?.endDate,
    wizard.frequency,
    wizard.postingTime,
  ]);

  // Ensure pillar percentages sum to exactly 100 by adjusting the last pillar
  const normalizePillars = (
    ps: Array<{ name: string; percentage: number }>
  ): Array<{ name: string; percentage: number }> => {
    if (!ps.length) return ps;
    const clamped = ps.map((p) => ({
      name: p.name,
      percentage: Math.max(0, Math.min(100, Math.round(Number(p.percentage) || 0))),
    }));
    const sum = clamped.reduce((s, p) => s + p.percentage, 0);
    const diff = 100 - sum;
    if (diff !== 0) {
      const last = clamped.length - 1;
      clamped[last] = {
        ...clamped[last],
        percentage: Math.max(0, Math.min(100, clamped[last].percentage + diff)),
      };
    }
    return clamped;
  };

  const isDefaultPillars = useMemo(() => {
    return (
      pillars.length === 3 &&
      pillars[0]?.name === 'Pillar 1' &&
      pillars[0]?.percentage === 34 &&
      pillars[1]?.name === 'Pillar 2' &&
      pillars[1]?.percentage === 33 &&
      pillars[2]?.name === 'Pillar 3' &&
      pillars[2]?.percentage === 33
    );
  }, [pillars]);

  const onGenerate = async () => {
    if (!canGenerate || !brand || !wizard.timeline) return;
    setIsGenerating(true);
    try {
      const res = await apiClient.generateCampaignStrategy({
        brandId: brand.id,
        name: wizard.name || 'Campaign',
        goals:
          Array.isArray(wizard.goals) && wizard.goals.length
            ? wizard.goals
            : ['Grow engagement and conversions'],
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
        const generatedPillars = normalizePillars(
          res.strategy.contentPillars.pillars.map((p) => ({
            name: p.name,
            percentage: p.percentage,
          }))
        );

        // Preserve user/analysis-provided pillars; only apply generated if using defaults
        if (wizard.contentPillars?.pillars?.length || !isDefaultPillars) {
          // Keep current UI pillars; do not override names/percentages
          setPillars(normalizePillars(pillars));
          // Optionally merge in AI themes by index without touching names/percentages
          try {
            const merged = pillars.map((p, i) => ({
              name: p.name,
              percentage: p.percentage,
              themes: res.strategy.contentPillars.pillars[i]?.themes || [],
            }));
            updateField('contentPillars', { pillars: merged });
          } catch {
            // Fallback: keep existing contentPillars if present
            if (wizard.contentPillars?.pillars?.length) {
              updateField('contentPillars', wizard.contentPillars);
            }
          }
        } else {
          setPillars(generatedPillars);
          updateField('contentPillars', {
            pillars: res.strategy.contentPillars.pillars.map((p, idx) => ({
              name: generatedPillars[idx]?.name ?? p.name,
              percentage: generatedPillars[idx]?.percentage ?? p.percentage,
              themes: p.themes || [],
            })),
          });
        }
        setPredictions(res.strategy.predictions);
        setPredictionsMeta(res.strategy.predictionsMeta || null);
        setSchedulePhases(res.strategy.schedule.phases);
        setSchedulePostingTime(res.strategy.schedule.postingTime);
        // Persist strategy details in wizard state so they survive refresh/navigation
        updateField('strategyPredictions', res.strategy.predictions);
        updateField('strategyPredictionsMeta', res.strategy.predictionsMeta || null);
        updateField('strategySchedule', {
          phases: res.strategy.schedule.phases,
          postingTime: res.strategy.schedule.postingTime || null,
        });
        // Auto-apply strategy optimizations (posting time, frequency, themes)
        try {
          const prevPosting = wizard.postingTime || null;
          const nextPosting = res.strategy.schedule.postingTime || null;
          if (nextPosting && nextPosting !== prevPosting) {
            wizard.updateField('postingTime', nextPosting);
          }

          const f = res.strategy.schedule.phases?.[0]?.frequency as
            | 'daily'
            | 'every2days'
            | '3weekly'
            | undefined;
          const prevFreq = wizard.frequency;
          if (f && f !== prevFreq) {
            wizard.updateField('frequency', f);
          }

          const prevThemes = Array.isArray(wizard.themes) ? wizard.themes : [];
          const pillarThemes = (res.strategy.contentPillars?.pillars || [])
            .flatMap((p) => p.themes || [])
            .filter(Boolean) as string[];
          const nextThemes = Array.from(new Set([...prevThemes, ...pillarThemes]));
          if (nextThemes.length !== prevThemes.length) {
            wizard.updateField('themes', nextThemes);
          }

          // Save accepted recommendations text if provided
          if (Array.isArray(res.strategy.recommendations) && res.strategy.recommendations.length) {
            wizard.updateField('acceptedRecommendations', res.strategy.recommendations);
          }

          setOptChanges({
            postingTime:
              nextPosting !== prevPosting ? { prev: prevPosting, next: nextPosting } : undefined,
            frequency: f && f !== prevFreq ? { prev: prevFreq, next: f } : undefined,
            themes:
              nextThemes.length !== prevThemes.length
                ? {
                    prev: prevThemes,
                    next: nextThemes,
                    added: nextThemes.filter((t) => !prevThemes.includes(t)),
                  }
                : undefined,
          });
          setOptimizationNoteVisible(true);
        } catch (applyErr) {
          console.error('Failed to auto-apply optimizations', applyErr);
        }
      }
    } catch (e) {
      console.error('generate strategy failed', e);
      toast.error('Failed to generate strategy. Open Help for guidance.');
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
        goal:
          (Array.isArray(wizard.goals) && wizard.goals.find((g) => g.trim().length > 0)) ||
          'Grow engagement and conversions',
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
    const normalized = ((arr: Array<{ name: string; percentage: number }>) => {
      const sum = arr.reduce((s, x) => s + Math.round(x.percentage), 0);
      const adjusted = arr.map((x) => ({ name: x.name, percentage: Math.round(x.percentage) }));
      if (sum !== 100 && adjusted.length) {
        adjusted[adjusted.length - 1].percentage += 100 - sum;
      }
      return adjusted;
    })(mapped);
    setPillars(normalized);
    updateField('contentPillars', {
      pillars: normalized.map((p, i) => ({
        name: p.name,
        percentage: p.percentage,
        themes: analysis.suggestedPillars[i]?.themes || [],
      })),
    });
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
            Use AI to propose content pillars and forecasts. You can edit before continuing.
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

      <WizardHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />

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
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setHelpOpen(true)}
                  className="text-blue-600 hover:underline"
                >
                  Learn more
                </button>
                <span className={total !== 100 ? 'text-red-600' : ''}>Total: {total}%</span>
              </div>
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
            <div className="flex items-center justify-between">
              <CardTitle>Forecast</CardTitle>
              <Badge variant={predictionsMeta?.basis === 'historical' ? 'default' : 'secondary'}>
                {predictionsMeta?.basis === 'historical' ? 'From data' : 'Heuristic'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-gray-600">
            {!predictions ? (
              <>
                <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200" />
                <div className="h-4 w-1/3 animate-pulse rounded bg-gray-200" />
              </>
            ) : (
              <div className="space-y-2 text-sm">
                <div>Estimated posts: {predictions.estimatedPosts}</div>
                {predictionsMeta?.basis === 'historical' ? (
                  <>
                    <div>
                      Reach range: {predictions.reach.low.toLocaleString()} –{' '}
                      {predictions.reach.high.toLocaleString()}
                    </div>
                    <div>Engagement rate: {(predictions.engagementRate * 100).toFixed(2)}%</div>
                    <div className="text-xs text-gray-500">
                      Based on your recent brand performance (samples:{' '}
                      {predictionsMeta.samples.reach} reach, {predictionsMeta.samples.engagement}{' '}
                      engagement).
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-gray-500">
                    We’ll calibrate reach and engagement after your first scheduled/published posts.
                  </div>
                )}

                {/* Improve accuracy checklist */}
                <div className="mt-3 space-y-2">
                  <div className="text-xs font-medium text-gray-700">Improve accuracy</div>
                  <ul className="list-disc space-y-1 pl-5 text-xs text-gray-700">
                    <li>
                      Connect Instagram for analytics{' '}
                      <button
                        type="button"
                        className="text-blue-600 hover:underline"
                        onClick={() => navigate('/brands')}
                      >
                        Connect now
                      </button>
                    </li>
                    <li>
                      Run brand analysis to enrich context{' '}
                      <button
                        type="button"
                        className="text-blue-600 hover:underline"
                        onClick={async () => {
                          if (!brand) return;
                          try {
                            await apiClient.startBrandAnalysis(brand.id, {
                              force: true,
                              maxPosts: 30,
                            });
                            toast.success('Brand analysis started');
                          } catch (e) {
                            console.error(e);
                            toast.error('Failed to start brand analysis');
                          }
                        }}
                      >
                        Start
                      </button>
                    </li>
                    <li>
                      Schedule & publish a few posts to unlock data{' '}
                      <button
                        type="button"
                        className="text-blue-600 hover:underline"
                        onClick={() => navigate('/content')}
                      >
                        Go to content
                      </button>
                    </li>
                  </ul>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Strategy Optimization Note (replaces Recommendations card) */}
      {optimizationNoteVisible && (
        <Alert>
          <AlertDescription className="flex w-full items-center justify-between">
            <span>Strategy optimized automatically.</span>
            <span className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setChangesOpen(true)}>
                View changes
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (!optChanges) return;
                  if (optChanges.postingTime)
                    wizard.updateField('postingTime', optChanges.postingTime.prev || '');
                  if (optChanges.frequency)
                    wizard.updateField('frequency', optChanges.frequency.prev);
                  if (optChanges.themes) wizard.updateField('themes', optChanges.themes.prev);
                  setOptimizationNoteVisible(false);
                  toast.success('Optimization undone');
                }}
              >
                Undo
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}

      {/* View Changes Dialog */}
      <Dialog open={changesOpen} onOpenChange={setChangesOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Applied changes</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-gray-700">
            {!optChanges && <div>No changes were applied.</div>}
            {optChanges?.postingTime && (
              <div>
                <div className="text-gray-600">Posting time</div>
                <div>
                  {optChanges.postingTime.prev || '—'} → {optChanges.postingTime.next || '—'}
                </div>
              </div>
            )}
            {optChanges?.frequency && (
              <div>
                <div className="text-gray-600">Frequency</div>
                <div>
                  {optChanges.frequency.prev || '—'} → {optChanges.frequency.next}
                </div>
              </div>
            )}
            {optChanges?.themes && (
              <div>
                <div className="text-gray-600">Themes</div>
                <div className="text-xs">Added: {optChanges.themes.added.join(', ') || '—'}</div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangesOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tips */}
      <Card>
        <CardContent className="flex items-start gap-3 text-sm text-gray-700">
          <Lightbulb className="mt-0.5 h-4 w-4 text-amber-500" />
          <div>
            <div className="font-medium">Tips</div>
            <p>
              Analyze Goal will pre-fill content pillars and may suggest a cadence. Generate with AI
              uses your current brief to build a schedule and forecasts. If you change pillars or
              frequency, click Generate again to update forecasts.
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
