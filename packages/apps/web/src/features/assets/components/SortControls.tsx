import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { type SortDirection, type SortField } from './asset-utils';

interface SortControlsProps {
  field: SortField;
  direction: SortDirection;
  onFieldChange: (field: SortField) => void;
  onDirectionToggle: () => void;
}

export function SortControls({
  field,
  direction,
  onFieldChange,
  onDirectionToggle,
}: SortControlsProps) {
  return (
    <div className="inline-flex items-center">
      <Select value={field} onValueChange={(v) => onFieldChange(v as SortField)}>
        <SelectTrigger className="h-10 w-[200px] rounded-r-none">
          <SelectValue placeholder="Sort assets" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="created">Added date</SelectItem>
          <SelectItem value="size">Size</SelectItem>
          <SelectItem value="title">Title</SelectItem>
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        className="h-10 rounded-l-none border-l-0"
        onClick={onDirectionToggle}
        aria-label={`Sort ${direction === 'asc' ? 'ascending' : 'descending'}`}
      >
        {direction === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
      </Button>
    </div>
  );
}
