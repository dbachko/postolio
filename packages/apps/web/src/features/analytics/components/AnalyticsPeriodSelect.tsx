import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Period } from '../types';
import { daysFromPeriod } from '../utils';

function periodFromDays(days: number): Period {
  if (days === 7) {
    return '7d';
  }
  if (days === 90) {
    return '90d';
  }
  return '30d';
}

export function AnalyticsPeriodSelect({
  value,
  onChange,
}: {
  value: Period;
  onChange: (next: Period) => void;
}) {
  return (
    <Select
      value={String(daysFromPeriod(value))}
      onValueChange={(v) => onChange(periodFromDays(Number(v)))}
    >
      <SelectTrigger className="w-full sm:w-[160px]">
        <SelectValue placeholder="Select range" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="7">Last 7 days</SelectItem>
        <SelectItem value="30">Last 30 days</SelectItem>
        <SelectItem value="90">Last 90 days</SelectItem>
      </SelectContent>
    </Select>
  );
}
