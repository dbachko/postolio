import { useCallback, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { content as contentApi, publishingQueues as publishingQueuesApi } from '@/lib/api';
import type { QueueScheduleLaneProps } from './types';
import { getScheduleLimitMessage, groupInstancesByDay } from './helpers';
import { QueueScheduleBacklog } from './components/queue-schedule-backlog';
import { QueueScheduleDayGroup } from './components/queue-schedule-day-group';

function useQueueScheduleLaneActions({
  brandId,
  scheduleLimitMessage,
}: {
  brandId: string;
  scheduleLimitMessage: string;
}) {
  const queryClient = useQueryClient();
  const invalidateAfterChange = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['publishing-queue-slot-instances'] });
    queryClient.invalidateQueries({ queryKey: ['publishing-queue-items'] });
    queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
  }, [brandId, queryClient]);
  const handleDropToSlot = useCallback(
    async (params: {
      contentId: string;
      scheduledAt: string;
      sourceQueueItem?: { queueId: string; queueItemId: string } | null;
    }) => {
      await contentApi.updateContent({
        contentId: params.contentId,
        scheduledAt: params.scheduledAt,
      });
      if (params.sourceQueueItem) {
        try {
          await publishingQueuesApi.removeQueueItem(
            params.sourceQueueItem.queueId,
            params.sourceQueueItem.queueItemId
          );
        } catch (error) {
          console.error(error);
          toast.error('Scheduled, but failed to remove from queue. Refresh to resolve.');
        }
      }
      invalidateAfterChange();
    },
    [invalidateAfterChange]
  );
  return { handleDropToSlot, scheduleLimitMessage };
}

function QueueScheduleLaneEmptyState({
  laneView,
}: {
  laneView: QueueScheduleLaneProps['laneView'];
}) {
  return (
    <div className="text-muted-foreground text-sm">
      No upcoming {laneView === 'all' ? '' : `${laneView} `}slots found. Add slots in{' '}
      <Button
        variant="link"
        asChild
        className="h-auto p-0 text-sm font-medium underline underline-offset-4"
      >
        <Link to="/social-accounts/publishing-schedule">Social Accounts</Link>
      </Button>
      .
    </div>
  );
}

function QueueScheduleLaneBody({
  grouped,
  laneView,
  ...props
}: {
  grouped: ReturnType<typeof groupInstancesByDay>;
  laneView: QueueScheduleLaneProps['laneView'];
} & Omit<QueueScheduleLaneProps, 'laneView' | 'instances'> & {
    handleDropToSlot: (params: {
      contentId: string;
      scheduledAt: string;
      sourceQueueItem?: { queueId: string; queueItemId: string } | null;
    }) => Promise<void>;
    scheduleLimitMessage: string;
  }) {
  return (
    <div className="space-y-4">
      {grouped.map(([dayKey, dayInstances]) => (
        <QueueScheduleDayGroup
          key={dayKey}
          dayKey={dayKey}
          dayInstances={dayInstances}
          laneView={laneView}
          itemsByEstimatedMs={props.itemsByEstimatedMs}
          calendarContentById={props.calendarContentById}
          assetsById={props.assetsById}
          brandTimezone={props.brandTimezone}
          nowUtcMs={props.nowUtcMs}
          onCreate={props.onCreate}
          onOpen={props.onOpen}
          onDropToSlot={props.handleDropToSlot}
          scheduleAheadAtCapacity={props.scheduleAheadAtCapacity}
          scheduleLimitMessage={props.scheduleLimitMessage}
        />
      ))}
    </div>
  );
}

export function QueueScheduleLane(props: QueueScheduleLaneProps) {
  const grouped = useMemo(
    () => groupInstancesByDay(props.instances, props.brandTimezone),
    [props.instances, props.brandTimezone]
  );
  const actions = useQueueScheduleLaneActions({
    brandId: props.brandId,
    scheduleLimitMessage: getScheduleLimitMessage(props.scheduleAheadLimits),
  });

  let laneBody: ReactNode;
  if (props.isLoading) {
    laneBody = <div className="bg-muted h-32 animate-pulse rounded" />;
  } else if (props.instances.length === 0) {
    laneBody = <QueueScheduleLaneEmptyState laneView={props.laneView} />;
  } else {
    laneBody = <QueueScheduleLaneBody grouped={grouped} {...props} {...actions} />;
  }

  return (
    <div className="p-4">
      {laneBody}

      <QueueScheduleBacklog
        unassigned={props.unassigned}
        laneView={props.laneView}
        assetsById={props.assetsById}
        calendarContentById={props.calendarContentById}
        onOpen={props.onOpen}
        scheduleAheadAtCapacity={props.scheduleAheadAtCapacity}
        scheduleLimitMessage={actions.scheduleLimitMessage}
      />
    </div>
  );
}
