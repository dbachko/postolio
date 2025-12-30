import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export function DragHandle({
  disabled,
  dragRef,
  tooltip,
}: {
  disabled: boolean;
  dragRef: (node: HTMLSpanElement | null) => void;
  tooltip?: string;
}) {
  const handle = (
    <span
      ref={dragRef}
      className={cn(
        'text-muted-foreground inline-flex h-8 w-5 shrink-0 items-center justify-center',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-grab active:cursor-grabbing'
      )}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      aria-hidden="true"
    >
      <GripVertical className="h-4 w-4" />
    </span>
  );

  if (!tooltip) return handle;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{handle}</TooltipTrigger>
        <TooltipContent>
          <span>{tooltip}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
