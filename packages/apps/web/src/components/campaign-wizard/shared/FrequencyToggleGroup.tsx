import { Label } from '../../ui/label';
import { RadioGroup, RadioGroupItem } from '../../ui/radio-group';
import { cn } from '@/lib/utils';
import { frequencyOptions } from '../../../constants/campaign';

interface FrequencyToggleGroupProps {
  value: string;
  onChange: (value: string) => void;
}

export function FrequencyToggleGroup({ value, onChange }: FrequencyToggleGroupProps) {
  return (
    <div className="space-y-2">
      <Label>Frequency</Label>
      <RadioGroup
        value={value}
        onValueChange={onChange}
        className="grid grid-cols-1 gap-2 sm:grid-cols-3"
      >
        {frequencyOptions.map((opt) => {
          const id = `freq-${opt.value}`;
          const checked = value === opt.value;
          return (
            <label
              key={opt.value}
              htmlFor={id}
              className={cn(
                'flex cursor-pointer items-center justify-center gap-2 rounded-md border p-2 text-sm transition-colors',
                checked ? 'border-blue-500 bg-blue-50 text-blue-700' : 'hover:bg-gray-50'
              )}
            >
              <RadioGroupItem id={id} value={opt.value} className="sr-only" />
              <span>{opt.label}</span>
            </label>
          );
        })}
      </RadioGroup>
    </div>
  );
}
