import { GripVertical } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PostStatusTimeBadge } from '@/components/post-status-time-badge';
import { cn } from '@/lib/utils';
import type { PostCardDragMeta } from '../drag-meta';
import type { PostStatus } from '../types';

type StatusBadgeProps = {
  status: PostStatus;
  displayTime: string;
  statusTooltip: string;
  dragMeta: PostCardDragMeta;
};

export function StatusBadge({ status, displayTime, statusTooltip, dragMeta }: StatusBadgeProps) {
  return (
    <PostStatusTimeBadge
      status={status}
      variant="inline"
      className="relative"
      iconClassName={cn(
        'transition-opacity duration-150 ease-out',
        dragMeta.show ? 'group-hover:opacity-0' : null
      )}
      iconOverlay={
        dragMeta.show ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  aria-label={dragMeta.canDrag ? 'Drag to reschedule' : 'Dragging disabled'}
                  className={cn(
                    'text-muted-foreground hover:text-foreground pointer-events-none absolute inset-0 inline-flex items-center justify-center rounded-sm opacity-0 transition-opacity duration-150 ease-out group-hover:pointer-events-auto group-hover:opacity-100',
                    dragMeta.canDrag
                      ? 'cursor-grab active:cursor-grabbing'
                      : 'cursor-not-allowed group-hover:opacity-70'
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <GripVertical className="h-4 w-4" aria-hidden="true" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <span>{dragMeta.tooltip}</span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null
      }
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {displayTime ? (
              <span className="font-medium underline-offset-2 hover:underline">{displayTime}</span>
            ) : (
              <span className="italic">No time</span>
            )}
          </TooltipTrigger>
          <TooltipContent>
            <span>{statusTooltip}</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </PostStatusTimeBadge>
  );
}
