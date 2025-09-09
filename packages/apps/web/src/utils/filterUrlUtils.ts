import type { ContentStatus, ContentType } from "../stores/calendarFilterStore";

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
    params.set("campaigns", filters.campaigns.join(","));
  }

  // Statuses
  if (filters.statuses.length > 0) {
    params.set("statuses", filters.statuses.join(","));
  }

  // Content types
  if (filters.contentTypes.length > 0 && filters.contentTypes.length < 2) {
    params.set("types", filters.contentTypes.join(","));
  }

  // Date range
  if (filters.dateRange.start) {
    params.set(
      "dateStart",
      filters.dateRange.start.toISOString().split("T")[0],
    );
  }
  if (filters.dateRange.end) {
    params.set("dateEnd", filters.dateRange.end.toISOString().split("T")[0]);
  }

  // Search query
  if (filters.searchQuery) {
    params.set("search", filters.searchQuery);
  }

  return params;
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
  const campaignsParam = searchParams.get("campaigns");
  const campaigns = campaignsParam
    ? campaignsParam.split(",").filter(Boolean)
    : [];

  // Statuses
  const statusesParam = searchParams.get("statuses");
  const validStatuses: ContentStatus[] = [
    "draft",
    "scheduled",
    "published",
    "failed",
    "skipped",
  ];
  const statuses = statusesParam
    ? (statusesParam
        .split(",")
        .filter((s) =>
          validStatuses.includes(s as ContentStatus),
        ) as ContentStatus[])
    : [];

  // Content types
  const typesParam = searchParams.get("types");
  const validTypes: ContentType[] = ["post", "placeholder"];
  const contentTypes = typesParam
    ? (typesParam
        .split(",")
        .filter((t) => validTypes.includes(t as ContentType)) as ContentType[])
    : (["post", "placeholder"] as ContentType[]); // Default to showing all types

  // Date range
  const dateStartParam = searchParams.get("dateStart");
  const dateEndParam = searchParams.get("dateEnd");
  const dateRange = {
    start: dateStartParam ? new Date(dateStartParam) : null,
    end: dateEndParam ? new Date(dateEndParam) : null,
  };

  // Search query
  const searchQuery = searchParams.get("search") || "";

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
  b: ReturnType<typeof decodeFiltersFromURL>,
): boolean {
  return (
    JSON.stringify(a.campaigns.sort()) === JSON.stringify(b.campaigns.sort()) &&
    JSON.stringify(a.statuses.sort()) === JSON.stringify(b.statuses.sort()) &&
    JSON.stringify(a.contentTypes.sort()) ===
      JSON.stringify(b.contentTypes.sort()) &&
    a.dateRange.start?.getTime() === b.dateRange.start?.getTime() &&
    a.dateRange.end?.getTime() === b.dateRange.end?.getTime() &&
    a.searchQuery === b.searchQuery
  );
}
