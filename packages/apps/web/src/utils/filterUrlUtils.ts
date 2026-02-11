import type { ContentStatus } from '../stores/calendarFilterStore';

export interface URLFilterParams {
  statuses?: ContentStatus[];
  search?: string;
}

/**
 * Encode filter state to URL search params
 */
export function encodeFiltersToURL(filters: {
  statuses: ContentStatus[];
  searchQuery: string;
}): URLSearchParams {
  const params = new URLSearchParams();

  // Statuses
  if (filters.statuses.length > 0) {
    params.set('statuses', filters.statuses.join(','));
  }

  // Search query
  if (filters.searchQuery) {
    params.set('search', filters.searchQuery);
  }

  return params;
}

/**
 * Decode URL search params to filter state
 */
export function decodeFiltersFromURL(searchParams: URLSearchParams): {
  statuses: ContentStatus[];
  searchQuery: string;
} {
  // Statuses
  const statusesParam = searchParams.get('statuses');
  const validStatuses: ContentStatus[] = ['draft', 'scheduled', 'published', 'failed', 'skipped'];
  const statuses = statusesParam
    ? (statusesParam
        .split(',')
        .filter((s) => validStatuses.includes(s as ContentStatus)) as ContentStatus[])
    : [];

  // Search query
  const searchQuery = searchParams.get('search') || '';

  return {
    statuses,
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
    JSON.stringify(a.statuses.sort()) === JSON.stringify(b.statuses.sort()) &&
    a.searchQuery === b.searchQuery
  );
}
