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
import { cn } from '@/lib/utils';

type SortOption<TField extends string> = {
  value: TField;
  label: string;
};

interface SortControlsProps<TField extends string = SortField> {
  field: TField;
  direction: SortDirection;
  onFieldChange: (field: TField) => void;
  onDirectionToggle: () => void;
  options?: Array<SortOption<TField>>;
  placeholder?: string;
  triggerWidthClassName?: string;
}

const DEFAULT_ASSET_SORT_OPTIONS: Array<SortOption<SortField>> = [
  { value: 'created', label: 'Added date' },
  { value: 'size', label: 'Size' },
  { value: 'title', label: 'Title' },
];

const DEFAULT_TRIGGER_WIDTH_CLASS = 'sm:w-[200px]';

function getOptions<TField extends string>(
  options: Array<SortOption<TField>> | undefined
): Array<SortOption<TField>> {
  if (options && options.length > 0) return options;
  return DEFAULT_ASSET_SORT_OPTIONS as unknown as Array<SortOption<TField>>;
}

export function SortControls<TField extends string = SortField>({
  field,
  direction,
  onFieldChange,
  onDirectionToggle,
  options,
  placeholder = 'Sort assets',
  triggerWidthClassName = DEFAULT_TRIGGER_WIDTH_CLASS,
}: SortControlsProps<TField>) {
  const sortOptions = getOptions(options);

  return (
    <div className="flex w-full items-center sm:w-auto">
      <Select value={field} onValueChange={(v) => onFieldChange(v as TField)}>
        <SelectTrigger
          className={cn(
            'h-10 w-full rounded-r-none [&>span]:pr-2 [&>svg]:ml-2',
            triggerWidthClassName
          )}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {sortOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
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
