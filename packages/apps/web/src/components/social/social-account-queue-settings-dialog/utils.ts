import type {
  PublishingQueueSlot,
  PublishingQueueSummary,
} from '@/lib/api/publishing-queues-client';

export function getQueuesFromQueryData(data: unknown): PublishingQueueSummary[] {
  const list = (data as any)?.data?.queues;
  return Array.isArray(list) ? (list as PublishingQueueSummary[]) : [];
}

export function getSlotsFromQueryData(data: unknown): PublishingQueueSlot[] {
  const list = (data as any)?.data?.slots;
  return Array.isArray(list) ? (list as PublishingQueueSlot[]) : [];
}
