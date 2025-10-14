import { useMemo } from 'react';
import { useCampaignWizard } from '../../../hooks/useCampaignWizard';
import { Card, CardHeader, CardTitle, CardContent } from '../../ui/card';
import { Button } from '../../ui/button';

function computeSchedule(
  start: string,
  end: string,
  frequency: 'daily' | 'every2days' | '3weekly'
): string[] {
  const dates: string[] = [];
  if (!start || !end) return dates;
  const s = new Date(start);
  const e = new Date(end);
  const current = new Date(s);
  while (current <= e) {
    dates.push(current.toISOString().slice(0, 10));
    switch (frequency) {
      case 'daily':
        current.setDate(current.getDate() + 1);
        break;
      case 'every2days':
        current.setDate(current.getDate() + 2);
        break;
      case '3weekly': {
        const day = current.getDay();
        if (day === 1)
          current.setDate(current.getDate() + 2); // Mon->Wed
        else if (day === 3)
          current.setDate(current.getDate() + 2); // Wed->Fri
        else current.setDate(current.getDate() + 3); // Fri->Mon
        break;
      }
      default:
        current.setDate(current.getDate() + 7);
    }
  }
  return dates;
}

export function Step4Timeline() {
  const { timeline, frequency, postingTime, updateField, prevStep, nextStep } = useCampaignWizard();

  const items = useMemo(() => {
    if (!timeline?.startDate || !timeline?.endDate || !frequency) return [] as string[];
    return computeSchedule(timeline.startDate, timeline.endDate, frequency as any);
  }, [timeline?.startDate, timeline?.endDate, frequency]);

  const applyOptimal = (time: string) => {
    updateField('postingTime', time);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Optimal Times</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          {['10:00', '14:00', '18:00'].map((t) => (
            <Button
              key={t}
              variant={t === postingTime ? 'default' : 'outline'}
              onClick={() => applyOptimal(t)}
            >
              {t}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schedule Overview</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="text-sm text-gray-600">
              Set your timeline and frequency to preview schedule.
            </div>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {items.map((d) => (
                <div
                  key={d}
                  className="flex items-center justify-between rounded border p-2 text-sm"
                >
                  <span>{d}</span>
                  <span className="text-gray-600">{postingTime}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={prevStep}>
          Back
        </Button>
        <Button onClick={nextStep}>Continue</Button>
      </div>
    </div>
  );
}
