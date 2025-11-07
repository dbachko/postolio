import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectionCardProps {
  icon?: string;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Unified card-based selection component for campaign wizard
 * Used across multiple steps for consistent UI/UX
 */
export function SelectionCard({
  icon,
  title,
  description,
  selected,
  onClick,
  disabled = false,
  className,
}: SelectionCardProps) {
  return (
    <Card
      className={cn(
        'cursor-pointer transition-all hover:shadow-md',
        selected ? 'ring-primary bg-primary/5 shadow-lg ring-2' : 'hover:border-primary',
        disabled && 'cursor-not-allowed opacity-50',
        className
      )}
      onClick={disabled ? undefined : onClick}
    >
      <CardContent className="p-6">
        {icon && (
          <div className="mb-3 text-4xl" role="img" aria-label={title}>
            {icon}
          </div>
        )}
        <h3 className="mb-2 text-lg font-semibold">{title}</h3>
        <p className="text-muted-foreground text-sm">{description}</p>
        {selected && (
          <div className="text-primary mt-3 flex items-center gap-2">
            <CheckCircle className="h-5 w-5" />
            <span className="text-sm font-medium">Selected</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
