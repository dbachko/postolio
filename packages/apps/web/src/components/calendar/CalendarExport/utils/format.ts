import { format } from 'date-fns';
import type { CalendarExportDateRange } from '../types';

export function buildFileTimestamp(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

export function formatDateRange(range?: CalendarExportDateRange): string | null {
  if (!range || (!range.start && !range.end)) {
    return null;
  }

  const startLabel = range.start ? format(range.start, 'MMM d') : null;
  const endLabel = range.end ? format(range.end, 'MMM d, yyyy') : null;

  if (startLabel && endLabel) {
    return `${startLabel} - ${endLabel}`;
  }

  return startLabel ?? endLabel;
}
