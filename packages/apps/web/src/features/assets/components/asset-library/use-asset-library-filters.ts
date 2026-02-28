import { useCallback, useState } from 'react';

import {
  useDebouncedValue,
  type AssetTypeFilter,
  type SortDirection,
  type SortField,
} from '../asset-utils';
import { createEmptyAssetFilters } from './constants';
import type { AssetFilters } from '../FilterPanel';

export type AssetLibraryFiltersState = {
  searchInput: string;
  setSearchInput: (value: string) => void;
  search: string;
  typeFilter: AssetTypeFilter;
  setTypeFilter: (value: AssetTypeFilter) => void;
  sortField: SortField;
  setSortField: (value: SortField) => void;
  sortDirection: SortDirection;
  setSortDirection: (value: SortDirection | ((value: SortDirection) => SortDirection)) => void;
  labelIds: string[];
  setLabelIds: (value: string[]) => void;
  filters: AssetFilters;
  setFilters: (value: AssetFilters) => void;
  resetAllFilters: () => void;
  resetPanelFilters: () => void;
};

export function useAssetLibraryFiltersState(): AssetLibraryFiltersState {
  const [searchInput, setSearchInput] = useState('');
  const [typeFilter, setTypeFilter] = useState<AssetTypeFilter>('all');
  const [sortField, setSortField] = useState<SortField>('created');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [filters, setFilters] = useState<AssetFilters>(createEmptyAssetFilters);
  const search = useDebouncedValue(searchInput, 350);

  const resetPanelFilters = useCallback(() => {
    setLabelIds([]);
    setFilters(createEmptyAssetFilters());
  }, []);

  const resetAllFilters = useCallback(() => {
    setSearchInput('');
    setTypeFilter('all');
    setSortField('created');
    setSortDirection('desc');
    resetPanelFilters();
  }, [resetPanelFilters]);

  return {
    searchInput,
    setSearchInput,
    search,
    typeFilter,
    setTypeFilter,
    sortField,
    setSortField,
    sortDirection,
    setSortDirection,
    labelIds,
    setLabelIds,
    filters,
    setFilters,
    resetAllFilters,
    resetPanelFilters,
  };
}
