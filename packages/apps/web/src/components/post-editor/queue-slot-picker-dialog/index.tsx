import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { publishingQueues as publishingQueuesApi } from '@/lib/api';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';
import { formatInTimeZone } from 'date-fns-tz';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

import type {
  PublishingQueueLaneKey,
  PublishingQueueSlotInstance,
} from '@/lib/api/publishing-queues-client';
import { getDefaultQueueId } from '@/components/publishing-queues/queue-utils';

type QueueSlotPickerDialogProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  socialAccountId: string | null;
  laneKey: PublishingQueueLaneKey;
  brandTimezone: string;
  onPick: (scheduledAtIso: string) => void;
};

type QueueSlotPickerStateContentProps = {
  socialAccountId: string | null;
  queueId: string | null;
  laneKey: PublishingQueueLaneKey;
  brandTimezone: string;
  instances: PublishingQueueSlotInstance[];
  firstAvailable: PublishingQueueSlotInstance | null;
  isQueueLoading: boolean;
  isInstancesLoading: boolean;
  onPick: (scheduledAtIso: string) => void;
  onOpenChange: (next: boolean) => void;
};

function useQueueSlotPickerData({
  open,
  socialAccountId,
  laneKey,
}: Pick<QueueSlotPickerDialogProps, 'open' | 'socialAccountId' | 'laneKey'>) {
  const queuesQuery = useQuery({
    queryKey: ['publishing-queues', socialAccountId],
    queryFn: () => publishingQueuesApi.listQueuesForSocialAccount(socialAccountId!),
    enabled: open && Boolean(socialAccountId),
    staleTime: CACHE_TIMES.STANDARD,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });

  const queueId = useMemo(() => getDefaultQueueId(queuesQuery.data as any), [queuesQuery.data]);

  const instancesQuery = useQuery({
    queryKey: ['publishing-queue-slot-instances', queueId, laneKey],
    queryFn: () =>
      publishingQueuesApi.listSlotInstances({
        queueId: queueId!,
        laneKey,
        limit: 50,
        after: new Date().toISOString(),
      }),
    enabled: open && Boolean(queueId),
    staleTime: 0,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });

  const instances = useMemo(() => {
    const raw = instancesQuery.data as any;
    const list = raw?.data?.instances;
    return Array.isArray(list) ? (list as PublishingQueueSlotInstance[]) : [];
  }, [instancesQuery.data]);

  const firstAvailable = instances.find((instance) => !instance.occupied) || null;

  return { queueId, queuesQuery, instancesQuery, instances, firstAvailable };
}

function SlotInstanceRow({
  instance,
  brandTimezone,
  onPick,
  onOpenChange,
}: {
  instance: PublishingQueueSlotInstance;
  brandTimezone: string;
  onPick: (scheduledAtIso: string) => void;
  onOpenChange: (next: boolean) => void;
}) {
  const label = formatInTimeZone(
    new Date(instance.scheduledAt),
    brandTimezone,
    'EEE, MMM d · h:mm a'
  );

  return (
    <div key={instance.scheduledAt} className="flex items-center justify-between gap-3 p-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{label}</div>
        <div className="text-muted-foreground truncate text-xs">
          {instance.occupied ? 'Occupied' : 'Available'}
        </div>
      </div>
      {instance.occupied ? (
        <Badge variant="secondary" className="shrink-0">
          Occupied
        </Badge>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => {
            onPick(instance.scheduledAt);
            onOpenChange(false);
          }}
        >
          Use
        </Button>
      )}
    </div>
  );
}

function QueueSlotPickerList({
  laneKey,
  brandTimezone,
  instances,
  firstAvailable,
  onPick,
  onOpenChange,
}: {
  laneKey: PublishingQueueLaneKey;
  brandTimezone: string;
  instances: PublishingQueueSlotInstance[];
  firstAvailable: PublishingQueueSlotInstance | null;
  onPick: (scheduledAtIso: string) => void;
  onOpenChange: (next: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-muted-foreground text-sm">
          Lane: <span className="text-foreground font-medium">{laneKey}</span>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={!firstAvailable}
          onClick={() => {
            if (!firstAvailable) {
              return;
            }

            onPick(firstAvailable.scheduledAt);
            onOpenChange(false);
          }}
        >
          Use next available
        </Button>
      </div>

      <ScrollArea className="h-[360px] rounded-md border">
        <div className="divide-border divide-y">
          {instances.length === 0 ? (
            <div className="text-muted-foreground p-4 text-sm">
              No upcoming slots found. Add slots in Social Accounts -&gt; Publishing Schedule.
            </div>
          ) : (
            instances.map((instance) => (
              <SlotInstanceRow
                key={instance.scheduledAt}
                instance={instance}
                brandTimezone={brandTimezone}
                onPick={onPick}
                onOpenChange={onOpenChange}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function QueueSlotPickerStateContent({
  socialAccountId,
  queueId,
  laneKey,
  brandTimezone,
  instances,
  firstAvailable,
  isQueueLoading,
  isInstancesLoading,
  onPick,
  onOpenChange,
}: QueueSlotPickerStateContentProps) {
  if (!socialAccountId) {
    return (
      <div className="text-muted-foreground text-sm">
        Pick exactly one destination to choose a slot.
      </div>
    );
  }

  if (isQueueLoading) {
    return <div className="bg-muted h-24 animate-pulse rounded" />;
  }

  if (!queueId) {
    return (
      <div className="text-muted-foreground text-sm">
        No default queue found for this social account.
      </div>
    );
  }

  if (isInstancesLoading) {
    return <div className="bg-muted h-40 animate-pulse rounded" />;
  }

  return (
    <QueueSlotPickerList
      laneKey={laneKey}
      brandTimezone={brandTimezone}
      instances={instances}
      firstAvailable={firstAvailable}
      onPick={onPick}
      onOpenChange={onOpenChange}
    />
  );
}

export function QueueSlotPickerDialog({
  open,
  onOpenChange,
  socialAccountId,
  laneKey,
  brandTimezone,
  onPick,
}: QueueSlotPickerDialogProps) {
  const { queueId, queuesQuery, instancesQuery, instances, firstAvailable } =
    useQueueSlotPickerData({
      open,
      socialAccountId,
      laneKey,
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pick a slot</DialogTitle>
          <DialogDescription>
            Choose a time from your queue schedule for this post type. Times are shown in{' '}
            {brandTimezone}.
          </DialogDescription>
        </DialogHeader>

        <QueueSlotPickerStateContent
          socialAccountId={socialAccountId}
          queueId={queueId}
          laneKey={laneKey}
          brandTimezone={brandTimezone}
          instances={instances}
          firstAvailable={firstAvailable}
          isQueueLoading={queuesQuery.isLoading}
          isInstancesLoading={instancesQuery.isLoading}
          onPick={onPick}
          onOpenChange={onOpenChange}
        />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
