import { formatInTimeZone } from 'date-fns-tz';
import { parseISO } from 'date-fns';
import type { Campaign } from '@/lib/api';
import type { EditableFlags } from './types';

export function getEditPermissions(status: Campaign['status']): EditableFlags {
  switch (status) {
    case 'creating':
    case 'preview':
    case 'failed':
      return {
        all: true,
        name: true,
        dates: true,
        frequency: true,
        postingTime: true,
        themes: true,
        style: true,
        color: true,
        reason: 'All fields are editable for this campaign status.',
      };
    case 'active':
    case 'paused':
      return {
        all: false,
        name: true,
        dates: false,
        frequency: false,
        postingTime: false,
        themes: false,
        style: false,
        color: true,
        reason: 'Active/paused campaigns only allow editing name.',
      };
    case 'completed':
      return {
        all: false,
        name: false,
        dates: false,
        frequency: false,
        postingTime: false,
        themes: false,
        style: false,
        color: false,
        reason: 'Completed campaigns are read-only.',
      };
    default:
      return {
        all: false,
        name: true,
        dates: false,
        frequency: false,
        postingTime: false,
        themes: false,
        style: false,
        color: true,
        reason: 'Limited editing is available for this campaign status.',
      };
  }
}

export function toDateInputValue(value: unknown, timezone?: string): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    if (timezone) return formatInTimeZone(value, timezone, 'yyyy-MM-dd');
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^\\d{4}-\\d{2}-\\d{2}$/.test(trimmed)) return trimmed;
    try {
      const date = parseISO(trimmed);
      if (Number.isNaN(date.getTime())) return '';
      if (timezone) return formatInTimeZone(date, timezone, 'yyyy-MM-dd');
      return date.toISOString().slice(0, 10);
    } catch {
      const date = new Date(trimmed);
      if (Number.isNaN(date.getTime())) return '';
      if (timezone) return formatInTimeZone(date, timezone, 'yyyy-MM-dd');
      return date.toISOString().slice(0, 10);
    }
  }
  return '';
}

export function toSelectableStyleValue(value: unknown): string {
  if (Array.isArray(value)) {
    const cleaned = value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
    return cleaned.join('; ');
  }
  if (typeof value === 'string') return value.trim();
  return '';
}

export function normalizeOptionValue(
  current: string,
  options: Array<{ value: string; label: string }>
): string {
  if (!current) return '';
  const byValue = options.find((o) => o.value === current);
  if (byValue) return byValue.value;
  const byLabel = options.find((o) => o.label.toLowerCase() === current.toLowerCase());
  return byLabel ? byLabel.value : current;
}
