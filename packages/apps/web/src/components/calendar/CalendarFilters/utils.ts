import { format } from 'date-fns';
import type { ContentStatus, ContentType } from '../../../stores/calendarFilterStore';

export const STATUS_OPTIONS: {
  value: ContentStatus;
  label: string;
  variant: 'outline' | 'info' | 'success' | 'destructive' | 'warning';
}[] = [
  { value: 'draft', label: 'Draft', variant: 'outline' },
  { value: 'scheduled', label: 'Scheduled', variant: 'info' },
  { value: 'published', label: 'Published', variant: 'success' },
  { value: 'failed', label: 'Failed', variant: 'destructive' },
  { value: 'skipped', label: 'Skipped', variant: 'warning' },
];

export const CONTENT_TYPE_OPTIONS: { value: ContentType; label: string }[] = [
  { value: 'post', label: 'Posts' },
  { value: 'placeholder', label: 'AI Placeholders' },
];

export const formatDateRange = (start: Date | null, end: Date | null): string => {
  if (!start && !end) return '';
  const startStr = start ? format(start, 'MMM d') : '';
  const endStr = end ? format(end, 'MMM d') : '';
  return `${startStr}${startStr && endStr ? ' - ' : ''}${endStr}`;
};
