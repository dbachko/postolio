import { useMemo } from 'react';
import { Label } from '../../ui/label';
import { RadioGroup, RadioGroupItem } from '../../ui/radio-group';
import { cn } from '@/lib/utils';
import { Input } from '../../ui/input';
import { frequencyOptions } from '../../../constants/campaign';

interface FrequencyToggleGroupProps {
  value: string;
  onChange: (value: string) => void;
}

export function FrequencyToggleGroup({ value, onChange }: FrequencyToggleGroupProps) {
  const builtinValues = useMemo(() => frequencyOptions.map((o) => o.value), []);
  const selectedValue = builtinValues.includes(value) ? value : 'custom';
  return (
    <div className="space-y-2">
      <Label>
        Frequency{' '}
        <span className="text-destructive" aria-hidden>
          *
        </span>
      </Label>
      <RadioGroup
        value={selectedValue}
        onValueChange={(v) => {
          // Allow selecting custom explicitly; set to empty to enable custom entry
          if (v === 'custom') {
            onChange('');
          } else {
            onChange(v);
          }
        }}
        className="grid grid-cols-1 gap-2 sm:grid-cols-3"
      >
        {frequencyOptions.map((opt) => {
          const id = `freq-${opt.value}`;
          const checked = selectedValue === opt.value;
          return (
            <label
              key={opt.value}
              htmlFor={id}
              className={cn(
                'flex h-full min-h-16 cursor-pointer items-center justify-center gap-2 rounded-md border p-2 text-sm transition-colors',
                checked ? 'ring-ring bg-muted ring-1' : 'hover:bg-muted'
              )}
            >
              <RadioGroupItem id={id} value={opt.value} className="sr-only" />
              <span>{opt.label}</span>
            </label>
          );
        })}
        {/* Custom schedule card */}
        <label
          htmlFor="freq-custom"
          className={cn(
            'flex h-full min-h-16 cursor-pointer items-center gap-2 rounded-md border p-2 text-sm transition-colors sm:col-span-3',
            selectedValue === 'custom' ? 'ring-ring bg-muted ring-1' : 'hover:bg-muted'
          )}
        >
          <RadioGroupItem id="freq-custom" value="custom" className="sr-only" />
          <div className="flex w-full flex-col gap-1">
            <span className="font-medium">Custom schedule</span>
            <Input
              type="text"
              placeholder="e.g., Mondays and Wednesdays; Tue, Thu; every 2 days"
              value={selectedValue === 'custom' ? value : ''}
              onFocus={() => {
                if (selectedValue !== 'custom') onChange('');
              }}
              onChange={(e) => onChange(e.target.value)}
            />
          </div>
        </label>
      </RadioGroup>
    </div>
  );
}
