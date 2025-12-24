import type { ContentStatus } from '@/stores/calendarFilterStore';

export const STATUS_OPTIONS: {
  value: ContentStatus;
  label: string;
}[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'published', label: 'Published' },
  { value: 'failed', label: 'Failed' },
  { value: 'skipped', label: 'Skipped' },
];
