import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Period } from '../types';
import { daysFromPeriod } from '../utils';

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
      onValueChange={(v) => onChange(Number(v) === 7 ? '7d' : Number(v) === 90 ? '90d' : '30d')}
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
