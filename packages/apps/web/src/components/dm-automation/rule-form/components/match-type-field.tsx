import type { CreateRuleInput } from '@/lib/api';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface MatchTypeFieldProps {
  value: CreateRuleInput['triggerConfig']['matchType'];
  onChange: (value: CreateRuleInput['triggerConfig']['matchType']) => void;
}

export function MatchTypeField({ value, onChange }: MatchTypeFieldProps) {
  return (
    <div>
      <Label htmlFor="matchType">Match Type</Label>
      <Select
        value={value}
        onValueChange={(next) => onChange(next as CreateRuleInput['triggerConfig']['matchType'])}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="exact">Exact Match</SelectItem>
          <SelectItem value="contains">Contains</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-muted-foreground mt-1 text-xs">
        Exact: Must match the entire text exactly. Contains: Can appear anywhere in the text.
      </p>
    </div>
  );
}
