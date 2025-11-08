import type { ContentStatus, ContentType } from '../stores/calendarFilterStore';
import { formatLocalDate } from '../lib/timezone';

export interface URLFilterParams {
  campaigns?: string[];
  statuses?: ContentStatus[];
  types?: ContentType[];
  dateStart?: string;
  dateEnd?: string;
  search?: string;
}

/**
 * Encode filter state to URL search params
 */
export function encodeFiltersToURL(filters: {
  campaigns: string[];
  statuses: ContentStatus[];
  contentTypes: ContentType[];
  dateRange: { start: Date | null; end: Date | null };
  searchQuery: string;
}): URLSearchParams {
  const params = new URLSearchParams();

  // Campaigns
  if (filters.campaigns.length > 0) {
    params.set('campaigns', filters.campaigns.join(','));
  }

  // Statuses
  if (filters.statuses.length > 0) {
    params.set('statuses', filters.statuses.join(','));
  }

  // Content types
  if (filters.contentTypes.length > 0 && filters.contentTypes.length < 2) {
    params.set('types', filters.contentTypes.join(','));
  }

  // Date range - format in local timezone (YYYY-MM-DD)
  if (filters.dateRange.start) {
    params.set('dateStart', formatLocalDate(filters.dateRange.start));
  }
  if (filters.dateRange.end) {
    params.set('dateEnd', formatLocalDate(filters.dateRange.end));
  }

  // Search query
  if (filters.searchQuery) {
    params.set('search', filters.searchQuery);
  }

  return params;
}

/**
 * Parse a date string (YYYY-MM-DD) in local timezone context
 * CRITICAL: new Date('2025-01-15') creates UTC date, causing timezone shifts
 */
function parseLocalDate(dateStr: string): Date | null {
  if (!dateStr) return null;

  // Only support YYYY-MM-DD format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    console.warn(`Invalid date format in URL: ${dateStr}. Expected YYYY-MM-DD`);
    return null;
  }

  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = parseInt(yearStr!, 10);
  const month = parseInt(monthStr!, 10) - 1; // Month is 0-indexed
  const day = parseInt(dayStr!, 10);

  if (isNaN(year) || isNaN(month) || isNaN(day)) {
    console.warn(`Invalid date components in URL: ${dateStr}`);
    return null;
  }

  // Create date at midnight in local timezone
  const date = new Date(year, month, day, 0, 0, 0, 0);

  // Validate the date is valid (catches invalid dates like Feb 30)
  if (isNaN(date.getTime())) {
    console.warn(`Invalid date in URL: ${dateStr}`);
    return null;
  }

  return date;
}

/**
 * Decode URL search params to filter state
 */
export function decodeFiltersFromURL(searchParams: URLSearchParams): {
  campaigns: string[];
  statuses: ContentStatus[];
  contentTypes: ContentType[];
  dateRange: { start: Date | null; end: Date | null };
  searchQuery: string;
} {
  // Campaigns
  const campaignsParam = searchParams.get('campaigns');
  const campaigns = campaignsParam ? campaignsParam.split(',').filter(Boolean) : [];

  // Statuses
  const statusesParam = searchParams.get('statuses');
  const validStatuses: ContentStatus[] = ['draft', 'scheduled', 'published', 'failed', 'skipped'];
  const statuses = statusesParam
    ? (statusesParam
        .split(',')
        .filter((s) => validStatuses.includes(s as ContentStatus)) as ContentStatus[])
    : [];

  // Content types
  const typesParam = searchParams.get('types');
  const validTypes: ContentType[] = ['post', 'placeholder'];
  const contentTypes = typesParam
    ? (typesParam.split(',').filter((t) => validTypes.includes(t as ContentType)) as ContentType[])
    : (['post', 'placeholder'] as ContentType[]); // Default to showing all types

  // Date range - parse in local timezone context
  const dateStartParam = searchParams.get('dateStart');
  const dateEndParam = searchParams.get('dateEnd');
  const dateRange = {
    start: parseLocalDate(dateStartParam || ''),
    end: parseLocalDate(dateEndParam || ''),
  };

  // Search query
  const searchQuery = searchParams.get('search') || '';

  return {
    campaigns,
    statuses,
    contentTypes,
    dateRange,
    searchQuery,
  };
}

/**
 * Check if two filter states are equal
 */
export function areFiltersEqual(
  a: ReturnType<typeof decodeFiltersFromURL>,
  b: ReturnType<typeof decodeFiltersFromURL>
): boolean {
  return (
    JSON.stringify(a.campaigns.sort()) === JSON.stringify(b.campaigns.sort()) &&
    JSON.stringify(a.statuses.sort()) === JSON.stringify(b.statuses.sort()) &&
    JSON.stringify(a.contentTypes.sort()) === JSON.stringify(b.contentTypes.sort()) &&
    a.dateRange.start?.getTime() === b.dateRange.start?.getTime() &&
    a.dateRange.end?.getTime() === b.dateRange.end?.getTime() &&
    a.searchQuery === b.searchQuery
  );
}
