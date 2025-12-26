import { useMemo } from 'react';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { Link } from 'react-router-dom';

import { getPostImageOrPlaceholder } from '@/lib/placeholders';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

import { getLanePillLabel, laneIcon } from './queue-schedules-utils';

import type { Content } from '@/lib/api';
import type {
  PublishingQueueItem,
  PublishingQueueLaneKey,
  PublishingQueueSlotInstance,
} from '@/lib/api/publishing-queues-client';
import type { AssetType } from '@/features/assets/api/client';

export function QueueScheduleLane({
  laneView,
  instances,
  itemsByEstimatedMs,
  calendarContentById,
  assetsById,
  brandTimezone,
  nowLocal,
  onCreate,
  onOpen,
  unassigned,
  isLoading,
}: {
  laneView: 'all' | Exclude<PublishingQueueLaneKey, 'any'>;
  instances: PublishingQueueSlotInstance[];
  itemsByEstimatedMs: Map<number, PublishingQueueItem>;
  calendarContentById: Map<string, Content>;
  assetsById?: Record<string, AssetType | null>;
  brandTimezone: string;
  nowLocal: Date;
  onCreate: (slotIso: string, slotLaneKey: PublishingQueueLaneKey) => void;
  onOpen: (contentId: string) => void;
  unassigned: PublishingQueueItem[];
  isLoading: boolean;
}) {
  const grouped = useMemo(() => {
    const byDay = new Map<string, PublishingQueueSlotInstance[]>();
    for (const inst of instances) {
      const dayKey = formatInTimeZone(new Date(inst.scheduledAt), brandTimezone, 'yyyy-MM-dd');
      if (!byDay.has(dayKey)) byDay.set(dayKey, []);
      byDay.get(dayKey)!.push(inst);
    }
    return Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [brandTimezone, instances]);

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
                    const slotLocal = toZonedTime(new Date(inst.scheduledAt), brandTimezone);
                    const isPast = slotLocal.getTime() < nowLocal.getTime();

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
                    const title =
                      occupiedContent?.caption ||
                      estimatedItem?.content?.caption ||
                      estimatedItem?.contentId ||
                      null;
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
                      <div
                        key={inst.scheduledAt}
                        className={cn(
                          'flex items-center justify-between gap-3 px-3 py-2.5',
                          isPast && 'opacity-70'
                        )}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="text-foreground w-16 shrink-0 text-sm font-medium">
                              {timeLabel}
                            </div>
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
                                  {laneIcon(laneView === 'all' ? inst.laneKey : laneView)}
                                </div>
                              )}
                              {laneView === 'all' && showContentId ? (
                                <div className="bg-background/80 border-border text-foreground absolute right-0.5 bottom-0.5 rounded-full border p-0.5">
                                  <span className="sr-only">{getLanePillLabel(inst.laneKey)}</span>
                                  {laneIcon(inst.laneKey, 'h-3 w-3')}
                                </div>
                              ) : null}
                            </div>
                            <div className="min-w-0">
                              {inst.occupied ? (
                                <div className="text-foreground truncate text-sm font-medium">
                                  Scheduled
                                </div>
                              ) : estimatedItem ? (
                                <div className="text-foreground truncate text-sm font-medium">
                                  Queued
                                </div>
                              ) : (
                                <div className="text-muted-foreground truncate text-sm font-medium">
                                  Empty slot
                                </div>
                              )}
                              {title ? (
                                <div className="text-muted-foreground truncate text-xs">
                                  {title}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          {showContentId ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => onOpen(showContentId)}
                            >
                              Open
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={isPast}
                              onClick={() => onCreate(inst.scheduledAt, inst.laneKey)}
                            >
                              Create
                            </Button>
                          )}
                        </div>
                      </div>
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
                <Button
                  key={item.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="hover:bg-muted h-auto w-full justify-between px-3 py-2 text-left"
                  onClick={() => onOpen(item.contentId)}
                >
                  {(() => {
                    const contentForThumb = calendarContentById.get(item.contentId) ?? null;
                    const primaryAssetId =
                      contentForThumb?.primaryAssetId ||
                      contentForThumb?.mediaAssets?.[0]?.assetId ||
                      item.content?.primaryAssetId ||
                      item.content?.mediaAssets?.[0]?.assetId ||
                      null;
                    const primaryAsset = primaryAssetId
                      ? (assetsById?.[primaryAssetId] ?? null)
                      : null;
                    const previewUrl =
                      primaryAsset?.fileType === 'video'
                        ? primaryAsset.thumbnailUrl || primaryAsset.url || null
                        : primaryAsset?.thumbnailUrl || primaryAsset?.url || null;

                    return (
                      <>
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <div className="bg-muted border-border relative h-9 w-9 shrink-0 overflow-hidden rounded-md border">
                            <img
                              src={getPostImageOrPlaceholder(previewUrl)}
                              alt=""
                              className="h-full w-full object-cover"
                              loading="lazy"
                              decoding="async"
                            />
                            {laneView === 'all' ? (
                              <div className="bg-background/80 border-border text-foreground absolute right-0.5 bottom-0.5 rounded-full border p-0.5">
                                <span className="sr-only">{getLanePillLabel(item.laneKey)}</span>
                                {laneIcon(item.laneKey, 'h-3 w-3')}
                              </div>
                            ) : null}
                          </div>
                          <div className="min-w-0">
                            <div className="text-foreground truncate text-sm font-medium">
                              {item.content?.caption || item.contentId}
                            </div>
                            <div className="text-muted-foreground truncate text-xs">Queued</div>
                          </div>
                        </div>

                        <div className="text-muted-foreground shrink-0 text-xs">Open</div>
                      </>
                    );
                  })()}
                </Button>
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
