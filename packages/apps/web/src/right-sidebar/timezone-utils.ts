import { formatInTimeZone } from 'date-fns-tz';

/**
 * Format a stored UTC timestamp for use in a `datetime-local` input.
 * Returns a YYYY-MM-DDTHH:mm string in the provided timezone.
 */
export const formatScheduledInput = (value?: string, timezone?: string): string => {
  if (!value) return '';
  const tz = timezone || 'UTC';
  return formatInTimeZone(new Date(value), tz, "yyyy-MM-dd'T'HH:mm");
};
