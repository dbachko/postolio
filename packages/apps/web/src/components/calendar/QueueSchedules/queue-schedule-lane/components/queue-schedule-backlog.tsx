import { Separator } from '@/components/ui/separator';
import type { QueueScheduleLaneProps } from '../types';
import { BacklogRow } from './backlog-row';

export function QueueScheduleBacklog({
  unassigned,
  laneView,
  assetsById,
  calendarContentById,
  onOpen,
  scheduleAheadAtCapacity,
  scheduleLimitMessage,
}: Pick<
  QueueScheduleLaneProps,
  | 'unassigned'
  | 'laneView'
  | 'assetsById'
  | 'calendarContentById'
  | 'onOpen'
  | 'scheduleAheadAtCapacity'
> & { scheduleLimitMessage: string }) {
  if (unassigned.length === 0) {
    return null;
  }
  return (
    <>
      <Separator className="my-4" />
      <div className="space-y-2">
        <div className="text-foreground text-sm font-semibold">Queued backlog</div>
        <div className="text-muted-foreground text-xs">
          These items don&apos;t have an estimated slot yet (no slots available in the next 7 days).
        </div>
        <div className="border-border divide-border divide-y overflow-hidden rounded-md border">
          {unassigned.slice(0, 20).map((item) => (
            <BacklogRow
              key={item.id}
              item={item}
              laneView={laneView}
              assetsById={assetsById}
              calendarContentById={calendarContentById}
              onOpen={onOpen}
              scheduleAheadAtCapacity={scheduleAheadAtCapacity}
              scheduleLimitMessage={scheduleLimitMessage}
            />
          ))}
          {unassigned.length > 20 ? (
            <div className="text-muted-foreground px-3 py-2 text-xs">
              +{unassigned.length - 20} more
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
