import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function CalendarCreateCta({
  date,
  onClick,
  disabled,
}: {
  date: Date;
  onClick?: (d: Date) => void;
  disabled?: boolean;
}) {
  return (
    <div className="pc-create-cta">
      <Button
        type="button"
        variant="outline"
        size="icon-xxs"
        aria-label="Create post"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          if (disabled) {
            return;
          }
          onClick?.(date);
        }}
      >
        <Plus className="h-3 w-3" aria-hidden="true" />
      </Button>
    </div>
  );
}
