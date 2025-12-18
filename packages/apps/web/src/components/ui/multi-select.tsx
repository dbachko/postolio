import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Badge } from './badge';

export interface MultiSelectOption {
  label: string;
  value: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
}

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  className,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);

  const handleToggle = (optionValue: string) => {
    const newValue = value.includes(optionValue)
      ? value.filter((v) => v !== optionValue)
      : [...value, optionValue];
    onChange(newValue);
  };

  const selectedLabels = options.filter((opt) => value.includes(opt.value)).map((opt) => opt.label);

  let triggerLabel: React.ReactNode;
  if (selectedLabels.length === 0) {
    triggerLabel = <span className="text-muted-foreground">{placeholder}</span>;
  } else if (selectedLabels.length === 1) {
    triggerLabel = selectedLabels[0];
  } else {
    triggerLabel = (
      <span className="flex items-center gap-1">
        {selectedLabels[0]}
        <Badge variant="secondary" className="ml-1">
          +{selectedLabels.length - 1}
        </Badge>
      </span>
    );
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('w-full justify-between', className)}
        >
          <span className="flex-1 truncate text-left">{triggerLabel}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          className={cn(
            'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 z-50 w-[var(--radix-popover-trigger-width)] rounded-md border p-1 shadow-md outline-none'
          )}
          align="start"
          sideOffset={4}
        >
          <div className="max-h-64 overflow-y-auto">
            {options.map((option) => {
              const isSelected = value.includes(option.value);
              return (
                <div
                  key={option.value}
                  className={cn(
                    'hover:bg-accent hover:text-accent-foreground relative flex cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm transition-colors outline-none select-none',
                    isSelected && 'bg-accent/50'
                  )}
                  onClick={() => handleToggle(option.value)}
                >
                  <div className="mr-2 flex h-4 w-4 items-center justify-center">
                    {isSelected && <Check className="h-4 w-4" />}
                  </div>
                  <span>{option.label}</span>
                </div>
              );
            })}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
