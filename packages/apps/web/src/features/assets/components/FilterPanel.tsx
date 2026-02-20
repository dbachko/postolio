import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { MultiSelect, type MultiSelectOption } from '@/components/ui/multi-select';
import { Filter, X } from 'lucide-react';
import { useState } from 'react';

export interface AssetFilters {
  aspectRatios: string[];
  orientationTypes: Array<'portrait' | 'landscape' | 'square'>;
  recentOnly?: boolean;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  uploadedAfter?: string;
  uploadedBefore?: string;
  usageStatuses: Array<'used' | 'unused'>;
}

interface FilterPanelProps {
  filters: AssetFilters;
  labelIds?: string[];
  labelOptions?: MultiSelectOption[];
  onLabelIdsChange?: (labelIds: string[]) => void;
  onChange: (filters: AssetFilters) => void;
  onReset: () => void;
}

const ASPECT_RATIOS = [
  { label: '1:1', value: '1:1', description: 'Square' },
  { label: '4:5', value: '4:5', description: 'Portrait' },
  { label: '9:16', value: '9:16', description: 'Full vertical' },
  { label: '3:4', value: '3:4', description: 'Tall classic' },
  { label: '4:3', value: '4:3', description: 'Photo classic' },
  { label: '16:9', value: '16:9', description: 'Standard landscape' },
  { label: '1.91:1', value: '1.91:1', description: 'Social ads landscape' },
  { label: '2:1', value: '2:1', description: 'Ultra-wide' },
  { label: '2.39:1', value: '2.39:1', description: 'Cinematic wide' },
];

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
  const supportsLabelFiltering = typeof onLabelIdsChange === 'function';
  const applyLabelIds = onLabelIdsChange ?? (() => undefined);

  const hasActiveFilters =
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
    filters.usageStatuses.length > 0;

  const activeFilterCount =
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
    filters.usageStatuses.length;

  const orientationLabel: Record<'portrait' | 'landscape' | 'square', string> = {
    portrait: 'Portrait',
    landscape: 'Landscape',
    square: 'Square',
  };
  const usageLabel: Record<'used' | 'unused', string> = {
    used: 'Used in posts',
    unused: 'Unused',
  };
  const labelNameById = new Map(activeLabelOptions.map((option) => [option.value, option.label]));

  return (
    <div className="relative">
      <Button
        variant={hasActiveFilters ? 'default' : 'outline'}
        onClick={() => setIsOpen(!isOpen)}
        className="h-10 gap-2"
      >
        <Filter className="h-4 w-4" />
        Filters
        {activeFilterCount > 0 && (
          <Badge variant="secondary" className="ml-1">
            {activeFilterCount}
          </Badge>
        )}
      </Button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} aria-hidden="true" />

          {/* Filter Panel */}
          <div className="bg-background absolute top-12 right-0 z-50 w-96 rounded-lg border p-4 shadow-lg">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h3 className="font-semibold">Filter Assets</h3>
                <p className="text-muted-foreground text-sm">
                  Narrow results by visual properties.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (supportsLabelFiltering) {
                      applyLabelIds([]);
                    }
                    onReset();
                  }}
                  disabled={!hasActiveFilters}
                >
                  Clear all
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsOpen(false)}
                  className="h-6 w-6 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {hasActiveFilters ? (
              <div className="mb-4 rounded-lg border p-3">
                <div className="mb-2 text-sm font-semibold">Applied filters</div>
                <div className="flex flex-wrap gap-2">
                  {supportsLabelFiltering
                    ? activeLabelIds.map((labelId) => (
                        <Button
                          key={`chip-label-${labelId}`}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 rounded-full px-3"
                          onClick={() =>
                            applyLabelIds(activeLabelIds.filter((item) => item !== labelId))
                          }
                        >
                          Label: {labelNameById.get(labelId) ?? labelId}
                          <X className="ml-1 h-3.5 w-3.5" />
                        </Button>
                      ))
                    : null}
                  {filters.aspectRatios.map((ratio) => (
                    <Button
                      key={`chip-ratio-${ratio}`}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-full px-3"
                      onClick={() =>
                        onChange({
                          ...filters,
                          aspectRatios: filters.aspectRatios.filter((item) => item !== ratio),
                        })
                      }
                    >
                      Ratio: {ratio}
                      <X className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  ))}
                  {filters.orientationTypes.map((orientation) => (
                    <Button
                      key={`chip-orientation-${orientation}`}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-full px-3"
                      onClick={() =>
                        onChange({
                          ...filters,
                          orientationTypes: filters.orientationTypes.filter(
                            (item) => item !== orientation
                          ),
                        })
                      }
                    >
                      {orientationLabel[orientation]}
                      <X className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  ))}
                  {filters.recentOnly ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-full px-3"
                      onClick={() => onChange({ ...filters, recentOnly: false })}
                    >
                      Recently added
                      <X className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                  {filters.usageStatuses.map((usage) => (
                    <Button
                      key={`chip-usage-${usage}`}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-full px-3"
                      onClick={() =>
                        onChange({
                          ...filters,
                          usageStatuses: filters.usageStatuses.filter((item) => item !== usage),
                        })
                      }
                    >
                      {usageLabel[usage]}
                      <X className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  ))}
                  {filters.minWidth !== undefined ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-full px-3"
                      onClick={() => onChange({ ...filters, minWidth: undefined })}
                    >
                      Min width: {filters.minWidth}
                      <X className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                  {filters.maxWidth !== undefined ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-full px-3"
                      onClick={() => onChange({ ...filters, maxWidth: undefined })}
                    >
                      Max width: {filters.maxWidth}
                      <X className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                  {filters.minHeight !== undefined ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-full px-3"
                      onClick={() => onChange({ ...filters, minHeight: undefined })}
                    >
                      Min height: {filters.minHeight}
                      <X className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                  {filters.maxHeight !== undefined ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-full px-3"
                      onClick={() => onChange({ ...filters, maxHeight: undefined })}
                    >
                      Max height: {filters.maxHeight}
                      <X className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                  {filters.uploadedAfter ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-full px-3"
                      onClick={() => onChange({ ...filters, uploadedAfter: undefined })}
                    >
                      Uploaded after: {filters.uploadedAfter}
                      <X className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                  {filters.uploadedBefore ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-full px-3"
                      onClick={() => onChange({ ...filters, uploadedBefore: undefined })}
                    >
                      Uploaded before: {filters.uploadedBefore}
                      <X className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="space-y-6">
              {supportsLabelFiltering ? (
                <div>
                  <Label className="mb-2 block text-sm font-medium">
                    Labels
                    {activeLabelIds.length > 0 ? (
                      <span className="text-muted-foreground ml-1 text-xs font-normal">
                        ({activeLabelIds.length})
                      </span>
                    ) : null}
                  </Label>
                  <MultiSelect
                    options={activeLabelOptions}
                    value={activeLabelIds}
                    onChange={applyLabelIds}
                    placeholder="All labels"
                  />
                </div>
              ) : null}

              {/* Aspect Ratio Filter - PRIORITY */}
              <div>
                <Label className="mb-2 block text-sm font-medium">
                  Aspect Ratio
                  {filters.aspectRatios.length > 0 ? (
                    <span className="text-muted-foreground ml-1 text-xs font-normal">
                      ({filters.aspectRatios.length})
                    </span>
                  ) : null}
                </Label>
                <MultiSelect
                  options={ASPECT_RATIOS.map((ratio) => ({
                    label: `${ratio.label} - ${ratio.description}`,
                    value: ratio.value,
                  }))}
                  value={filters.aspectRatios}
                  onChange={(value) =>
                    onChange({
                      ...filters,
                      aspectRatios: value,
                    })
                  }
                  placeholder="All aspect ratios"
                />
              </div>

              {/* Orientation Filter */}
              <div>
                <Label className="mb-2 block text-sm font-medium">
                  Orientation
                  {filters.orientationTypes.length > 0 ? (
                    <span className="text-muted-foreground ml-1 text-xs font-normal">
                      ({filters.orientationTypes.length})
                    </span>
                  ) : null}
                </Label>
                <MultiSelect
                  options={[
                    { label: 'Portrait', value: 'portrait' },
                    { label: 'Landscape', value: 'landscape' },
                    { label: 'Square', value: 'square' },
                  ]}
                  value={filters.orientationTypes}
                  onChange={(value) =>
                    onChange({
                      ...filters,
                      orientationTypes: value as Array<'portrait' | 'landscape' | 'square'>,
                    })
                  }
                  placeholder="All orientations"
                />
              </div>

              {/* Usage Status Filter */}
              <div>
                <Label className="mb-2 block text-sm font-medium">
                  Usage Status
                  {filters.usageStatuses.length > 0 ? (
                    <span className="text-muted-foreground ml-1 text-xs font-normal">
                      ({filters.usageStatuses.length})
                    </span>
                  ) : null}
                </Label>
                <MultiSelect
                  options={[
                    { label: 'Unused', value: 'unused' },
                    { label: 'Used in Posts', value: 'used' },
                  ]}
                  value={filters.usageStatuses}
                  onChange={(value) =>
                    onChange({
                      ...filters,
                      usageStatuses: value as Array<'used' | 'unused'>,
                    })
                  }
                  placeholder="All assets"
                />
              </div>

              {/* Added Date Filter */}
              <div>
                <Label className="mb-2 block text-sm font-medium">
                  Added Date
                  {filters.recentOnly ? (
                    <span className="text-muted-foreground ml-1 text-xs font-normal">(1)</span>
                  ) : null}
                </Label>
                <MultiSelect
                  options={[{ label: 'Recently added (last 30 days)', value: 'recent' }]}
                  value={filters.recentOnly ? ['recent'] : []}
                  onChange={(value) =>
                    onChange({
                      ...filters,
                      recentOnly: value.includes('recent'),
                    })
                  }
                  placeholder="Any time"
                />
              </div>
            </div>

            <div className="mt-6 flex gap-2 border-t pt-4">
              <Button
                variant="default"
                size="sm"
                onClick={() => setIsOpen(false)}
                className="flex-1"
              >
                Done
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
