import { useCallback, useMemo } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

import { content as contentApi, publishingQueues as publishingQueuesApi } from '@/lib/api';

import { BacklogRow } from './components/backlog-row';
import { SlotRow } from './components/slot-row';
import type { QueueScheduleLaneProps } from './types';
import { getDisplayTitle, normalizeLaneKeyForContent } from './utils';

export function QueueScheduleLane({
  brandId,
  laneView,
  instances,
  itemsByEstimatedMs,
  calendarContentById,
  assetsById,
  brandTimezone,
  nowUtcMs,
  scheduleAheadAtCapacity,
  scheduleAheadLimits,
  onCreate,
  onOpen,
  unassigned,
  isLoading,
}: QueueScheduleLaneProps) {
  const queryClient = useQueryClient();
  const grouped = useMemo(() => {
    const byDay = new Map<string, typeof instances>();
    for (const inst of instances) {
      const dayKey = formatInTimeZone(new Date(inst.scheduledAt), brandTimezone, 'yyyy-MM-dd');
      if (!byDay.has(dayKey)) byDay.set(dayKey, []);
      byDay.get(dayKey)!.push(inst);
    }
    return Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [brandTimezone, instances]);

  const invalidateAfterChange = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['publishing-queue-slot-instances'] });
    queryClient.invalidateQueries({ queryKey: ['publishing-queue-items'] });
    queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
  }, [brandId, queryClient]);

  const scheduleLimitMessage = useMemo(() => {
    if (!scheduleAheadLimits) return 'Scheduling limit reached. Upgrade to add more.';
    return `Scheduling limit reached (${scheduleAheadLimits.currentCount}/${scheduleAheadLimits.maxAllowed}). Upgrade to add more.`;
  }, [scheduleAheadLimits]);

  const handleDropToSlot = useCallback(
    async (params: {
      contentId: string;
      scheduledAt: string;
      sourceQueueItem?: { queueId: string; queueItemId: string } | null;
    }) => {
      const { contentId, scheduledAt, sourceQueueItem } = params;

      await contentApi.updateContent({ contentId, scheduledAt });

      if (sourceQueueItem) {
        try {
          await publishingQueuesApi.removeQueueItem(
            sourceQueueItem.queueId,
            sourceQueueItem.queueItemId
          );
        } catch (queueRemoveError) {
          console.error(queueRemoveError);
          toast.error('Scheduled, but failed to remove from queue. Refresh to resolve.');
        }
      }

      invalidateAfterChange();
    },
    [invalidateAfterChange]
  );

  return (
    <div className="p-4">
      {isLoading ? (
        <div className="bg-muted h-32 animate-pulse rounded" />
      ) : instances.length === 0 ? (
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
      ) : (
        <div className="space-y-4">
          {grouped.map(([dayKey, dayInstances]) => {
            const first = dayInstances[0];
            const dayLabel = first
              ? formatInTimeZone(new Date(first.scheduledAt), brandTimezone, 'EEE, MMM d')
              : dayKey;
            return (
              <div key={dayKey} className="space-y-2">
                <div className="text-muted-foreground text-xs font-medium">{dayLabel}</div>
                <div className="border-border divide-border divide-y overflow-hidden rounded-md border">
                  {dayInstances.map((inst) => {
                    const slotMs = new Date(inst.scheduledAt).getTime();
                    const isPast = slotMs < nowUtcMs;

                    const estimatedItem = itemsByEstimatedMs.get(slotMs) ?? null;
                    const occupiedContent =
                      inst.occupied && inst.occupiedContentId
                        ? (calendarContentById.get(inst.occupiedContentId) ?? null)
                        : null;

                    const timeLabel = formatInTimeZone(
                      new Date(inst.scheduledAt),
                      brandTimezone,
                      'h:mm a'
                    );

                    const showContentId = occupiedContent?.id || estimatedItem?.contentId || null;
                    const title = showContentId
                      ? getDisplayTitle({
                          caption:
                            occupiedContent?.caption || estimatedItem?.content?.caption || null,
                          contentType:
                            occupiedContent?.contentType ||
                            estimatedItem?.content?.contentType ||
                            null,
                          laneKey:
                            estimatedItem?.laneKey ?? normalizeLaneKeyForContent(occupiedContent),
                        })
                      : null;
                    const contentForThumb = showContentId
                      ? (calendarContentById.get(showContentId) ?? null)
                      : null;
                    const primaryAssetId =
                      contentForThumb?.primaryAssetId ||
                      contentForThumb?.mediaAssets?.[0]?.assetId ||
                      estimatedItem?.content?.primaryAssetId ||
                      estimatedItem?.content?.mediaAssets?.[0]?.assetId ||
                      null;
                    const primaryAsset = primaryAssetId
                      ? (assetsById?.[primaryAssetId] ?? null)
                      : null;
                    const previewUrl =
                      primaryAsset?.fileType === 'video'
                        ? primaryAsset.thumbnailUrl || null
                        : primaryAsset?.thumbnailUrl || primaryAsset?.url || null;

                    return (
                      <SlotRow
                        key={inst.scheduledAt}
                        inst={inst}
                        laneView={laneView}
                        isPast={isPast}
                        timeLabel={timeLabel}
                        showContentId={showContentId}
                        title={title}
                        previewUrl={previewUrl}
                        occupiedContent={occupiedContent}
                        estimatedItem={estimatedItem}
                        onCreate={onCreate}
                        onOpen={onOpen}
                        onDropToSlot={handleDropToSlot}
                        scheduleAheadAtCapacity={scheduleAheadAtCapacity}
                        scheduleLimitMessage={scheduleLimitMessage}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {unassigned.length > 0 ? (
        <>
          <Separator className="my-4" />
          <div className="space-y-2">
            <div className="text-foreground text-sm font-semibold">Queued backlog</div>
            <div className="text-muted-foreground text-xs">
              These items don&apos;t have an estimated slot yet (no slots available in the next 7
              days).
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
      ) : null}
    </div>
  );
}
