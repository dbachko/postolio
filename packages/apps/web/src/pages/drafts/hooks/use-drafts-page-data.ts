import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useAssetsByIds } from '@/features/assets/hooks/useAssetsByIds';
import { useDebounce } from '@/hooks/useDebounce';
import { content as contentApi, type Content } from '@/lib/api';

import { groupDraftsByCreatedMonth } from '../utils';
import type { DraftSortField, DraftTypeFilter, SortDirection } from '../types';

function filterDraftsByType(drafts: Content[], typeFilter: DraftTypeFilter): Content[] {
  return drafts.filter((draft) => {
    const isScheduled = Boolean(draft.scheduledAt);
    if (typeFilter === 'scheduled') {
      return isScheduled;
    }
    if (typeFilter === 'unscheduled') {
      return !isScheduled;
    }
    return true;
  });
}

function filterDraftsBySearch(drafts: Content[], search: string): Content[] {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) {
    return drafts;
  }
  return drafts.filter((draft) => (draft.caption || '').toLowerCase().includes(normalizedSearch));
}

function sortDrafts(
  drafts: Content[],
  sortField: DraftSortField,
  sortDirection: SortDirection
): Content[] {
  const multiplier = sortDirection === 'asc' ? 1 : -1;
  return [...drafts].sort((a, b) => {
    const aTime =
      sortField === 'created'
        ? new Date(a.createdAt).getTime()
        : new Date(a.updatedAt || a.createdAt).getTime();
    const bTime =
      sortField === 'created'
        ? new Date(b.createdAt).getTime()
        : new Date(b.updatedAt || b.createdAt).getTime();
    if (aTime === bTime) {
      return a.id.localeCompare(b.id) * multiplier;
    }
    return (aTime - bTime) * multiplier;
  });
}

export function useDraftsPageData(brandId: string | undefined) {
  const [searchInput, setSearchInput] = useState('');
  const [typeFilter, setTypeFilter] = useState<DraftTypeFilter>('all');
  const [sortField, setSortField] = useState<DraftSortField>('lastModified');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const search = useDebounce(searchInput, 350);

  const draftsQuery = useQuery({
    queryKey: ['drafts', brandId],
    enabled: Boolean(brandId),
    queryFn: async () =>
      brandId ? ((await contentApi.getDrafts(brandId)) as { content: Content[] }) : { content: [] },
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });

  const filteredSortedDrafts = useMemo(() => {
    const allDrafts = draftsQuery.data?.content || [];
    const filteredByType = filterDraftsByType(allDrafts, typeFilter);
    const filteredBySearch = filterDraftsBySearch(filteredByType, search);
    return sortDrafts(filteredBySearch, sortField, sortDirection);
  }, [draftsQuery.data?.content, search, sortDirection, sortField, typeFilter]);

  const groupedDrafts = useMemo(() => {
    const groupDirection = sortField === 'created' ? sortDirection : 'desc';
    return groupDraftsByCreatedMonth(filteredSortedDrafts, groupDirection);
  }, [filteredSortedDrafts, sortDirection, sortField]);

  const assetsQuery = useAssetsByIds(filteredSortedDrafts.map((draft) => draft.primaryAssetId));
  const resetControls = () => {
    setSearchInput('');
    setTypeFilter('all');
    setSortField('lastModified');
    setSortDirection('desc');
  };

  return {
    searchInput,
    typeFilter,
    sortField,
    sortDirection,
    setSearchInput,
    setTypeFilter,
    setSortField,
    setSortDirection,
    resetControls,
    filteredSortedDrafts,
    groupedDrafts,
    assetsById: assetsQuery.data ?? {},
    draftsQuery,
  };
}
