import { addHours, format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

import { getLocalSetting } from '@/lib/settings/localSettings';
import { getTimezoneAbbr, toUTCFromInput } from '@/lib/timezone';
import type { Platform } from '@/lib/platform-config';

import { DISMISS_TTL_DAYS } from './constants';
import type { PostingAction } from './types';

export function isDismissedWithinTtl(key: string): boolean {
  try {
    const ts = getLocalSetting<number>(key);
    if (!ts || !Number.isFinite(ts)) return false;
    const ageMs = Date.now() - ts;
    return ageMs < DISMISS_TTL_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export function normalizeScheduledAtInput(
  value: string
): { datePart: string; timePart: string } | null {
  const trimmed = value.trim();
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(trimmed);
  if (!match) return null;
  return { datePart: match[1]!, timePart: match[2]! };
}

export function getDefaultScheduledAtInput(timezone?: string): string {
  const next = addHours(new Date(), 1);
  if (timezone) return formatInTimeZone(next, timezone, "yyyy-MM-dd'T'HH:mm");
  return format(next, "yyyy-MM-dd'T'HH:mm");
}

export function formatScheduledAtLabel(value: string, timezone?: string): string | null {
  if (!timezone) return null;
  const parts = normalizeScheduledAtInput(value);
  if (!parts) return null;
  try {
    const utc = toUTCFromInput(`${parts.datePart}T${parts.timePart}`, timezone);
    const label = formatInTimeZone(utc, timezone, 'MMM d, h:mm a');
    const tzAbbr = getTimezoneAbbr(timezone);
    return `${label} ${tzAbbr}`;
  } catch {
    return null;
  }
}

export function formatTimezoneLocationLabel(timezone?: string): string | null {
  const trimmed = (timezone || '').trim();
  if (!trimmed) return null;
  const parts = trimmed.split('/').filter(Boolean);
  const last = parts[parts.length - 1] || trimmed;
  const label = last.replaceAll('_', ' ');
  return label || null;
}

export function parsePlatformPrefixedMessage(message: string): {
  platform: Platform | null;
  message: string;
} {
  const trimmed = (message || '').trim();
  const match = /^(instagram|facebook|linkedin|x|youtube|tiktok):\s*/i.exec(trimmed);
  if (!match) return { platform: null, message: trimmed };
  const platform = match[1]?.toLowerCase() as Platform;
  const next = trimmed.slice(match[0].length).trim();
  return { platform, message: next || trimmed };
}

export function getPostingActionLabel(action: PostingAction): string {
  if (action === 'queue') return 'Next available';
  if (action === 'now') return 'Now';
  return 'Set date and time';
}
