import type { PublishingQueueSummary } from '@/lib/api/publishing-queues-client';

export function getDefaultQueueId(payload: unknown): string | null {
  const list = (payload as { data?: { queues?: unknown } } | null)?.data?.queues;
  if (!Array.isArray(list)) {
    return null;
  }
  const queues = list as PublishingQueueSummary[];
  const match = queues.find((q) => q.isDefault) || queues[0] || null;
  return match?.id ?? null;
}
