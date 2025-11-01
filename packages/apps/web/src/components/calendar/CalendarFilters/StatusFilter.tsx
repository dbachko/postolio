import { memo, useState } from 'react';
import { useCalendarFilterStore } from '../../../stores/calendarFilterStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { STATUS_OPTIONS } from './utils';

interface StatusFilterProps {
  compact?: boolean;
}

export const StatusFilter = memo(({ compact = false }: StatusFilterProps) => {
  const statuses = useCalendarFilterStore((s) => s.statuses);
  const toggleStatus = useCalendarFilterStore((s) => s.toggleStatus);
  const [isOpen, setIsOpen] = useState(false);

  const handleToggle = (status: string) => {
    toggleStatus(status as any);
  };

  return (
    <div>
      <Label className={`mb-1 text-xs ${compact ? 'sr-only' : ''}`}>Status</Label>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size={compact ? 'sm' : 'default'}
            className={`w-full justify-start ${compact ? 'h-8 text-xs' : ''}`}
          >
            {statuses.length === 0 ? 'All statuses' : `${statuses.length} selected`}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56">
          <div className="space-y-2">
            {STATUS_OPTIONS.map((option) => (
              <div key={option.value} className="flex items-center gap-2">
                <Checkbox
                  id={`status-${option.value}`}
                  checked={statuses.includes(option.value)}
                  onCheckedChange={() => handleToggle(option.value)}
                />
                <Label htmlFor={`status-${option.value}`} className="cursor-pointer">
                  <Badge variant={option.variant}>{option.label}</Badge>
                </Label>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
});
