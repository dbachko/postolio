import { useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../../ui/card';
import { Alert, AlertDescription } from '../../ui/alert';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { useCampaignWizard } from '../../../hooks/useCampaignWizard';

export function Step3StrategyReview() {
  const { prevStep, nextStep, contentPillars, updateField } = useCampaignWizard();
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

  return (
    <div className="space-y-6">
      <Alert>
        <AlertDescription>
          AI Strategy Generation – Coming in Phase 2. You can proceed without this step.
        </AlertDescription>
      </Alert>

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
            <div className="h-4 w-4/5 animate-pulse rounded bg-gray-200" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Predictions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-gray-600">
            <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-gray-200" />
          </CardContent>
        </Card>
      </div>

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
