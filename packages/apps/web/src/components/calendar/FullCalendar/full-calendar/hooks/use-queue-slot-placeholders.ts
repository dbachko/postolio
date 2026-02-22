import { useMemo } from 'react';

import type { PublishingQueueSlotInstance } from '@/lib/api/publishing-queues-client';

import type { PlaceholderItem } from '../../types';
import { isTimeOccupied } from '../utils';

type SlotRange = {
  endUtcMs: number;
};

type UseQueueSlotPlaceholdersParams = {
  effectiveSingleDestinationId: string | null;
  slotRange: SlotRange | null;
  slotInstancesData: unknown;
  occupiedTimesUtcMsSorted: number[];
  queueAtCapacity: boolean;
};

export function useQueueSlotPlaceholders({
  effectiveSingleDestinationId,
  slotRange,
  slotInstancesData,
  occupiedTimesUtcMsSorted,
  queueAtCapacity,
}: UseQueueSlotPlaceholdersParams) {
  return useMemo(() => {
    if (!effectiveSingleDestinationId) {
      return [] as PlaceholderItem[];
    }
    if (!slotRange) {
      return [] as PlaceholderItem[];
    }
    const raw = slotInstancesData as any;
    const list = raw?.data?.instances;
    const instances = Array.isArray(list) ? (list as PublishingQueueSlotInstance[]) : [];
    const endUtcMs = slotRange.endUtcMs;
    const nowUtcMs = Date.now();
    const occupiedUtcMsSorted = occupiedTimesUtcMsSorted;

    return instances
      .filter((i) => {
        const ms = new Date(i.scheduledAt).getTime();
        if (!Number.isFinite(ms)) {
          return false;
        }
        // Hide occupied slots (server-occupied OR occupied by queue estimation/content within 1 min).
        if (i.occupied) {
          return false;
        }
        if (isTimeOccupied({ candidateUtcMs: ms, occupiedUtcMsSorted })) {
          return false;
        }
        return true;
      })
      .filter((i) => {
        const ms = new Date(i.scheduledAt).getTime();
        return Number.isFinite(ms) && ms >= nowUtcMs && ms < endUtcMs;
      })
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
      .map((i) => {
        return {
          id: `queue-slot:${i.queueId}:${i.laneKey}:${i.scheduledAt}`,
          scheduledAt: i.scheduledAt,
          message: 'Queue slot',
          queueAtCapacity,
          // Extra fields consumed by PostPreviewCard -> open create with prefill
          targetSocialAccountId: effectiveSingleDestinationId,
          laneKey: i.laneKey,
          caption: 'Queue slot',
        } as unknown as PlaceholderItem;
      });
  }, [
    effectiveSingleDestinationId,
    occupiedTimesUtcMsSorted,
    queueAtCapacity,
    slotInstancesData,
    slotRange,
  ]);
}
