import type { ContentSeries, RollingConfig } from './types';

export function statusBadgeVariant(
  status: ContentSeries['status']
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'active') {
    return 'secondary';
  }
  if (status === 'paused') {
    return 'outline';
  }
  return 'outline';
}

export function toRollingConfig(value: unknown): RollingConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : false;
  const minQueueDays = Number.isFinite(Number(raw.minQueueDays))
    ? Math.max(1, Math.floor(Number(raw.minQueueDays)))
    : 3;
  const targetQueueDays = Number.isFinite(Number(raw.targetQueueDays))
    ? Math.max(minQueueDays, Math.floor(Number(raw.targetQueueDays)))
    : Math.max(minQueueDays, 7);
  const maxQueueDays = Number.isFinite(Number(raw.maxQueueDays))
    ? Math.max(targetQueueDays, Math.floor(Number(raw.maxQueueDays)))
    : Math.max(targetQueueDays, 14);
  const batchSize = Number.isFinite(Number(raw.batchSize))
    ? Math.max(1, Math.min(maxQueueDays, Math.floor(Number(raw.batchSize))))
    : 3;
  return {
    enabled,
    minQueueDays,
    targetQueueDays,
    maxQueueDays,
    batchSize,
  };
}

export function parseNumberInput(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, parsed);
}
