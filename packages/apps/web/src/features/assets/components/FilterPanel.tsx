import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { MultiSelect } from '@/components/ui/multi-select';
import { Filter, X } from 'lucide-react';
import { useState } from 'react';

export interface AssetFilters {
  aspectRatios: string[];
  orientationTypes: Array<'portrait' | 'landscape' | 'square'>;
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

export function FilterPanel({ filters, onChange, onReset }: FilterPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  const hasActiveFilters =
    filters.aspectRatios.length > 0 ||
    filters.orientationTypes.length > 0 ||
    filters.minWidth !== undefined ||
    filters.usageStatuses.length > 0;

  const activeFilterCount =
    filters.aspectRatios.length +
    filters.orientationTypes.length +
    (filters.minWidth !== undefined ? 1 : 0) +
    (filters.maxWidth !== undefined ? 1 : 0) +
    (filters.minHeight !== undefined ? 1 : 0) +
    (filters.maxHeight !== undefined ? 1 : 0) +
    (filters.uploadedAfter !== undefined ? 1 : 0) +
    (filters.uploadedBefore !== undefined ? 1 : 0) +
    filters.usageStatuses.length;

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
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold">Filter Assets</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsOpen(false)}
                className="h-6 w-6 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-6">
              {/* Aspect Ratio Filter - PRIORITY */}
              <div>
                <Label className="mb-2 block text-sm font-medium">Aspect Ratio</Label>
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
                <Label className="mb-2 block text-sm font-medium">Orientation</Label>
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
                <Label className="mb-2 block text-sm font-medium">Usage Status</Label>
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
            </div>

            {/* Reset Button */}
            <div className="mt-6 flex gap-2 border-t pt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={onReset}
                className="flex-1"
                disabled={!hasActiveFilters}
              >
                Reset Filters
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => setIsOpen(false)}
                className="flex-1"
              >
                Apply
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
