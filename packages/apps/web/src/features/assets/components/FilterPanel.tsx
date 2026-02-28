import { useState } from 'react';
import { Filter, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FilterPanelAppliedFilters } from './filter-panel-applied-filters';
import { FilterPanelFields } from './filter-panel-fields';
import type { AssetFilters as AssetFiltersType, FilterPanelProps } from './filter-panel-types';

export type AssetFilters = AssetFiltersType;

function hasActiveFilters(filters: AssetFilters, activeLabelIds: string[]) {
  return (
    activeLabelIds.length > 0 ||
    filters.aspectRatios.length > 0 ||
    filters.orientationTypes.length > 0 ||
    filters.recentOnly === true ||
    filters.minWidth !== undefined ||
    filters.maxWidth !== undefined ||
    filters.minHeight !== undefined ||
    filters.maxHeight !== undefined ||
    filters.uploadedAfter !== undefined ||
    filters.uploadedBefore !== undefined ||
    filters.usageStatuses.length > 0
  );
}

function getActiveFilterCount(filters: AssetFilters, activeLabelIds: string[]) {
  return (
    activeLabelIds.length +
    filters.aspectRatios.length +
    filters.orientationTypes.length +
    (filters.recentOnly === true ? 1 : 0) +
    (filters.minWidth !== undefined ? 1 : 0) +
    (filters.maxWidth !== undefined ? 1 : 0) +
    (filters.minHeight !== undefined ? 1 : 0) +
    (filters.maxHeight !== undefined ? 1 : 0) +
    (filters.uploadedAfter !== undefined ? 1 : 0) +
    (filters.uploadedBefore !== undefined ? 1 : 0) +
    filters.usageStatuses.length
  );
}

function FilterPanelPopover(props: {
  activeFilters: boolean;
  activeLabelIds: string[];
  activeLabelOptions: NonNullable<FilterPanelProps['labelOptions']>;
  activeLabelNameById: Map<string, string>;
  filters: AssetFilters;
  onChange: FilterPanelProps['onChange'];
  onLabelIdsChange: FilterPanelProps['onLabelIdsChange'];
  onReset: FilterPanelProps['onReset'];
  onClose: () => void;
}) {
  const clearAllFilters = () => {
    props.onLabelIdsChange?.([]);
    props.onReset();
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={props.onClose} aria-hidden="true" />

      <div className="bg-background absolute top-12 right-0 z-50 w-96 rounded-lg border p-4 shadow-lg">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h3 className="font-semibold">Filter Assets</h3>
            <p className="text-muted-foreground text-sm">Narrow results by visual properties.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearAllFilters}
              disabled={!props.activeFilters}
            >
              Clear all
            </Button>
            <Button variant="ghost" size="sm" onClick={props.onClose} className="h-6 w-6 p-0">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <FilterPanelAppliedFilters
          activeLabelIds={props.activeLabelIds}
          filters={props.filters}
          labelNameById={props.activeLabelNameById}
          onChange={props.onChange}
          onLabelIdsChange={props.onLabelIdsChange}
        />

        <FilterPanelFields
          activeLabelIds={props.activeLabelIds}
          activeLabelOptions={props.activeLabelOptions}
          filters={props.filters}
          onChange={props.onChange}
          onLabelIdsChange={props.onLabelIdsChange}
        />

        <div className="mt-6 flex gap-2 border-t pt-4">
          <Button variant="default" size="sm" onClick={props.onClose} className="flex-1">
            Done
          </Button>
        </div>
      </div>
    </>
  );
}

export function FilterPanel({
  filters,
  labelIds,
  labelOptions,
  onLabelIdsChange,
  onChange,
  onReset,
}: FilterPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const activeLabelIds = labelIds ?? [];
  const activeLabelOptions = labelOptions ?? [];
  const activeLabelNameById = new Map(
    activeLabelOptions.map((option) => [option.value, option.label])
  );
  const activeFilters = hasActiveFilters(filters, activeLabelIds);
  const activeFilterCount = getActiveFilterCount(filters, activeLabelIds);

  return (
    <div className="relative">
      <Button
        variant={activeFilters ? 'default' : 'outline'}
        onClick={() => setIsOpen((prev) => !prev)}
        className="h-10 gap-2"
      >
        <Filter className="h-4 w-4" />
        Filters
        {activeFilterCount > 0 ? (
          <Badge variant="secondary" className="ml-1">
            {activeFilterCount}
          </Badge>
        ) : null}
      </Button>

      {isOpen ? (
        <FilterPanelPopover
          activeFilters={activeFilters}
          activeLabelIds={activeLabelIds}
          activeLabelOptions={activeLabelOptions}
          activeLabelNameById={activeLabelNameById}
          filters={filters}
          onChange={onChange}
          onLabelIdsChange={onLabelIdsChange}
          onReset={onReset}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </div>
  );
}
