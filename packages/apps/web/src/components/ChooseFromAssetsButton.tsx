import { Images } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ChooseFromAssetsButtonProps {
  onClick: () => void;
  className?: string;
  /** Default is full-width. Set to false for auto width (e.g., inline in sidebars). */
  fullWidth?: boolean;
  /** Compact variant for tighter layouts (e.g., sidebar edit mode). */
  size?: 'default' | 'compact';
}

export function ChooseFromAssetsButton({
  onClick,
  className,
  fullWidth = true,
  size = 'default',
}: ChooseFromAssetsButtonProps) {
  const sizeClasses = size === 'compact' ? 'h-9 px-3 text-xs' : 'h-10 text-xs';
  const widthClasses = fullWidth ? 'w-full' : '';

  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      className={cn(
        'border-border bg-muted hover:bg-accent flex items-center justify-center rounded-lg border font-medium transition-colors',
        sizeClasses,
        widthClasses,
        className
      )}
    >
      <Images className="mr-2 h-3.5 w-3.5" />
      Choose from Assets
    </Button>
  );
}
