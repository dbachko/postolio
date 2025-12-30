import { useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface TimeQuickPickProps {
  value: string;
  onChange: (value: string) => void;
  quickTimes?: string[]; // in HH:mm 24h format
}

export function TimeQuickPick({ value, onChange, quickTimes }: TimeQuickPickProps) {
  const choices = useMemo(() => quickTimes ?? ['09:00', '12:00', '15:00', '18:00'], [quickTimes]);

  return (
    <div className="space-y-2">
      <Label>Preferred Posting Time</Label>
      <div className="flex flex-wrap gap-2">
        {choices.map((t) => (
          <Button
            key={t}
            type="button"
            variant={value === t ? 'default' : 'outline'}
            onClick={() => onChange(t)}
          >
            {t}
          </Button>
        ))}
      </div>
      <div>
        <Input type="time" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}
