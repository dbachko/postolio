import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FilterPanel, type AssetFilters } from '../FilterPanel';
import { SortControls } from '../SortControls';
import type { AssetTypeFilter, SortDirection, SortField } from '../asset-utils';

export interface AssetPickerHeaderProps {
  type?: 'image' | 'video';
  onClose: () => void;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  typeFilter: AssetTypeFilter;
  onTypeFilterChange: (value: AssetTypeFilter) => void;
  filters: AssetFilters;
  onFiltersChange: (next: AssetFilters) => void;
  onFiltersReset: () => void;
  sortField: SortField;
  sortDirection: SortDirection;
  onSortFieldChange: (field: SortField) => void;
  onSortDirectionToggle: () => void;
  selectedAssetsCount: number;
}

export interface AssetPickerFooterProps {
  onClose: () => void;
  onConfirm: () => void;
  selectedAssetsCount: number;
}

export function AssetPickerHeader({
  type,
  onClose,
  searchInput,
  onSearchInputChange,
  typeFilter,
  onTypeFilterChange,
  filters,
  onFiltersChange,
  onFiltersReset,
  sortField,
  sortDirection,
  onSortFieldChange,
  onSortDirectionToggle,
  selectedAssetsCount,
}: AssetPickerHeaderProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b p-4 lg:flex-nowrap lg:justify-between">
      <div className="relative min-w-[240px] flex-1">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <input
          type="text"
          placeholder="Search assets by title or filename"
          value={searchInput}
          onChange={(event) => onSearchInputChange(event.target.value)}
          className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border pr-3 pl-9 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        />
      </div>
      {!type ? (
        <Tabs
          value={typeFilter}
          onValueChange={(value) => onTypeFilterChange(value as AssetTypeFilter)}
          className="shrink-0"
        >
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="image">Images</TabsTrigger>
            <TabsTrigger value="video">Videos</TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}
      <div className="flex items-center gap-2">
        <FilterPanel filters={filters} onChange={onFiltersChange} onReset={onFiltersReset} />
        <SortControls
          field={sortField}
          direction={sortDirection}
          onFieldChange={onSortFieldChange}
          onDirectionToggle={onSortDirectionToggle}
        />
        <div className="text-muted-foreground text-sm whitespace-nowrap">
          {selectedAssetsCount > 0 ? `${selectedAssetsCount} selected` : ''}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClose}
        aria-label="Close"
        className="text-muted-foreground h-8 w-8"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function AssetPickerFooter({
  onClose,
  onConfirm,
  selectedAssetsCount,
}: AssetPickerFooterProps) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-2 border-t p-4">
      <Button type="button" variant="outline" onClick={onClose}>
        Cancel
      </Button>
      <Button type="button" onClick={onConfirm} disabled={selectedAssetsCount === 0}>
        Attach {selectedAssetsCount > 0 ? `(${selectedAssetsCount})` : ''}
      </Button>
    </div>
  );
}
