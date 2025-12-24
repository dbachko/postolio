import type { ContentStatus } from '../stores/calendarFilterStore';

export interface URLFilterParams {
  campaigns?: string[];
  statuses?: ContentStatus[];
  search?: string;
}

/**
 * Encode filter state to URL search params
 */
export function encodeFiltersToURL(filters: {
  campaigns: string[];
  statuses: ContentStatus[];
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
  campaigns: string[];
  statuses: ContentStatus[];
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

  // Search query
  const searchQuery = searchParams.get('search') || '';

  return {
    campaigns,
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
    JSON.stringify(a.campaigns.sort()) === JSON.stringify(b.campaigns.sort()) &&
    JSON.stringify(a.statuses.sort()) === JSON.stringify(b.statuses.sort()) &&
    a.searchQuery === b.searchQuery
  );
}
