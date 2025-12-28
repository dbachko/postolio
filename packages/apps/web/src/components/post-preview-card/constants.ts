// Query keys to invalidate after mutations
export const QUERY_KEYS_TO_INVALIDATE = [
  'calendar',
  'content',
  'publishing-queue-slot-instances-calendar',
  'publishing-queue-items-calendar',
  'publishing-queue-slot-instances',
  'publishing-queue-items',
] as const;

// Status labels for tooltips
export const STATUS_LABELS: Record<string, string> = {
  published: 'Published',
  scheduled: 'Scheduled',
  draft: 'Draft',
  failed: 'Failed',
  skipped: 'Skipped',
  placeholder: 'Empty slot',
};

// Breakpoint for wide/narrow card layout
export const WIDE_CARD_BREAKPOINT = 200;

// Optimistic action labels
export const OPTIMISTIC_LABELS: Record<string, string> = {
  queueing: 'Queueing…',
  rescheduling: 'Rescheduling…',
};
