import { getPostImageOrPlaceholder } from '@/lib/placeholders';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  getLaneCreateLabel,
  getLanePillLabel,
  laneIcon,
} from '@/components/calendar/QueueSchedules/queue-schedules-utils';
import type { SlotRowProps } from '../types';
import { DragHandle } from './drag-handle';
import { useSlotRowDndState } from './slot-row-helpers';

function SlotRowLeft({
  canDrag,
  dragPayload,
  dragRef,
  dragTooltip,
  timeLabel,
  showContentId,
  previewUrl,
  laneView,
  laneKey,
  occupied,
  estimatedItem,
  title,
}: {
  canDrag: boolean;
  dragPayload: unknown;
  dragRef: unknown;
  dragTooltip: string;
  timeLabel: string;
  showContentId: string | null;
  previewUrl: string | null;
  laneView: SlotRowProps['laneView'];
  laneKey: SlotRowProps['inst']['laneKey'];
  occupied: boolean;
  estimatedItem: SlotRowProps['estimatedItem'];
  title: string | null;
}) {
  let statusLabel = 'Empty slot';
  let statusClassName = 'text-muted-foreground truncate text-sm font-medium';
  if (occupied) {
    statusLabel = 'Scheduled';
    statusClassName = 'text-foreground truncate text-sm font-medium';
  } else if (estimatedItem) {
    statusLabel = 'Queued';
    statusClassName = 'text-foreground truncate text-sm font-medium';
  }

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        {dragPayload ? (
          <DragHandle disabled={!canDrag} dragRef={dragRef as any} tooltip={dragTooltip} />
        ) : (
          <span className="inline-flex h-8 w-5 shrink-0" aria-hidden="true" />
        )}
        <div className="text-foreground w-16 shrink-0 text-sm font-medium">{timeLabel}</div>
        <div className="bg-muted border-border relative h-9 w-9 shrink-0 overflow-hidden rounded-md border">
          {showContentId ? (
            <img
              src={getPostImageOrPlaceholder(previewUrl)}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="text-muted-foreground flex h-full w-full items-center justify-center">
              {laneIcon(laneView === 'all' ? laneKey : laneView)}
            </div>
          )}
          {laneView === 'all' && showContentId ? (
            <div className="bg-background/80 border-border text-foreground absolute right-0.5 bottom-0.5 rounded-full border p-0.5">
              <span className="sr-only">{getLanePillLabel(laneKey)}</span>
              {laneIcon(laneKey, 'h-3 w-3')}
            </div>
          ) : null}
        </div>
        <div className="min-w-0">
          <div className={statusClassName}>{statusLabel}</div>
          {title ? <div className="text-muted-foreground truncate text-xs">{title}</div> : null}
        </div>
      </div>
    </div>
  );
}

function SlotRowRight({
  showContentId,
  onOpen,
  createDisabledReason,
  onCreate,
  scheduledAt,
  laneKey,
  laneView,
}: {
  showContentId: string | null;
  onOpen: SlotRowProps['onOpen'];
  createDisabledReason: string | null;
  onCreate: SlotRowProps['onCreate'];
  scheduledAt: string;
  laneKey: SlotRowProps['inst']['laneKey'];
  laneView: SlotRowProps['laneView'];
}) {
  if (showContentId) {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onOpen(showContentId)}>
          Open
        </Button>
      </div>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-2">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={Boolean(createDisabledReason)}
                onClick={() => onCreate(scheduledAt, laneKey)}
              >
                {getLaneCreateLabel(laneView === 'all' ? laneKey : laneView)}
              </Button>
            </span>
          </TooltipTrigger>
          {createDisabledReason ? (
            <TooltipContent>
              <span>{createDisabledReason}</span>
            </TooltipContent>
          ) : null}
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

export function SlotRow(props: SlotRowProps) {
  const {
    canDrag,
    canDrop,
    createDisabledReason,
    dragPayload,
    dragRef,
    dragTooltip,
    dropRef,
    isOver,
  } = useSlotRowDndState({
    inst: props.inst,
    isPast: props.isPast,
    occupiedContent: props.occupiedContent,
    estimatedItem: props.estimatedItem,
    onDropToSlot: props.onDropToSlot,
    scheduleAheadAtCapacity: props.scheduleAheadAtCapacity,
    scheduleLimitMessage: props.scheduleLimitMessage,
  });

  return (
    <div
      ref={dropRef as any}
      className={cn(
        'hover:bg-muted/50 flex items-center justify-between gap-3 px-3 py-2.5 transition-colors',
        props.isPast && 'opacity-70',
        canDrop && 'bg-muted/40',
        isOver && canDrop && 'ring-ring/20 ring-2'
      )}
    >
      <SlotRowLeft
        canDrag={canDrag}
        dragPayload={dragPayload}
        dragRef={dragRef}
        dragTooltip={dragTooltip}
        timeLabel={props.timeLabel}
        showContentId={props.showContentId}
        previewUrl={props.previewUrl}
        laneView={props.laneView}
        laneKey={props.inst.laneKey}
        occupied={props.inst.occupied}
        estimatedItem={props.estimatedItem}
        title={props.title}
      />
      <SlotRowRight
        showContentId={props.showContentId}
        onOpen={props.onOpen}
        createDisabledReason={createDisabledReason}
        onCreate={props.onCreate}
        scheduledAt={props.inst.scheduledAt}
        laneKey={props.inst.laneKey}
        laneView={props.laneView}
      />
    </div>
  );
}
