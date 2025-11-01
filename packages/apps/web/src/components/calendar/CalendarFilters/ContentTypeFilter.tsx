import { memo, useMemo, useState } from 'react';
import { useCalendarFilterStore } from '../../../stores/calendarFilterStore';
import type { ContentType } from '../../../stores/calendarFilterStore';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { CONTENT_TYPE_OPTIONS } from './utils';

interface ContentTypeFilterProps {
  compact?: boolean;
}

export const ContentTypeFilter = memo(({ compact = false }: ContentTypeFilterProps) => {
  const contentTypes = useCalendarFilterStore((s) => s.contentTypes);
  const toggleContentType = useCalendarFilterStore((s) => s.toggleContentType);
  const [isOpen, setIsOpen] = useState(false);
  const buttonLabel = useMemo(() => {
    if (contentTypes.length === CONTENT_TYPE_OPTIONS.length) {
      return 'All types';
    }

    const labels = contentTypes
      .map((value) => CONTENT_TYPE_OPTIONS.find((option) => option.value === value)?.label)
      .filter((label): label is string => Boolean(label));

    if (labels.length === 0) {
      return 'Select types';
    }

    return labels.join(', ');
  }, [contentTypes]);

  const handleToggle = (value: ContentType) => {
    toggleContentType(value);
  };

  return (
    <div>
      <Label className={`mb-1 text-xs ${compact ? 'sr-only' : ''}`}>Content Type</Label>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size={compact ? 'sm' : 'default'}
            className={`w-full justify-start ${compact ? 'h-8 text-xs' : ''}`}
          >
            {buttonLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48">
          <div className="space-y-2">
            {CONTENT_TYPE_OPTIONS.map((option) => (
              <div key={option.value} className="flex items-center gap-2">
                <Checkbox
                  id={`ctype-${option.value}`}
                  checked={contentTypes.includes(option.value)}
                  onCheckedChange={() => handleToggle(option.value)}
                />
                <Label htmlFor={`ctype-${option.value}`} className="cursor-pointer font-normal">
                  <span className="text-sm">{option.label}</span>
                </Label>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
});
