import { Label } from '@/components/ui/label';
import { MultiSelect, type MultiSelectOption } from '@/components/ui/multi-select';
import { ASPECT_RATIOS, type AssetFilters } from './filter-panel-types';

function FilterFieldLabel({ title, count }: { title: string; count: number }) {
  return (
    <Label className="mb-2 block text-sm font-medium">
      {title}
      {count > 0 ? (
        <span className="text-muted-foreground ml-1 text-xs font-normal">({count})</span>
      ) : null}
    </Label>
  );
}

function LabelsField({
  activeLabelIds,
  activeLabelOptions,
  onLabelIdsChange,
}: {
  activeLabelIds: string[];
  activeLabelOptions: MultiSelectOption[];
  onLabelIdsChange: (labelIds: string[]) => void;
}) {
  return (
    <div>
      <FilterFieldLabel title="Labels" count={activeLabelIds.length} />
      <MultiSelect
        options={activeLabelOptions}
        value={activeLabelIds}
        onChange={onLabelIdsChange}
        placeholder="All labels"
      />
    </div>
  );
}

function AspectRatioField({
  filters,
  onChange,
}: {
  filters: AssetFilters;
  onChange: (next: AssetFilters) => void;
}) {
  return (
    <div>
      <FilterFieldLabel title="Aspect Ratio" count={filters.aspectRatios.length} />
      <MultiSelect
        options={ASPECT_RATIOS.map((ratio) => ({
          label: `${ratio.label} - ${ratio.description}`,
          value: ratio.value,
        }))}
        value={filters.aspectRatios}
        onChange={(value) => onChange({ ...filters, aspectRatios: value })}
        placeholder="All aspect ratios"
      />
    </div>
  );
}

function OrientationField({
  filters,
  onChange,
}: {
  filters: AssetFilters;
  onChange: (next: AssetFilters) => void;
}) {
  return (
    <div>
      <FilterFieldLabel title="Orientation" count={filters.orientationTypes.length} />
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
  );
}

function UsageField({
  filters,
  onChange,
}: {
  filters: AssetFilters;
  onChange: (next: AssetFilters) => void;
}) {
  return (
    <div>
      <FilterFieldLabel title="Usage Status" count={filters.usageStatuses.length} />
      <MultiSelect
        options={[
          { label: 'Unused', value: 'unused' },
          { label: 'Used in Posts', value: 'used' },
        ]}
        value={filters.usageStatuses}
        onChange={(value) =>
          onChange({ ...filters, usageStatuses: value as Array<'used' | 'unused'> })
        }
        placeholder="All assets"
      />
    </div>
  );
}

function AddedDateField({
  filters,
  onChange,
}: {
  filters: AssetFilters;
  onChange: (next: AssetFilters) => void;
}) {
  return (
    <div>
      <FilterFieldLabel title="Added Date" count={filters.recentOnly ? 1 : 0} />
      <MultiSelect
        options={[{ label: 'Recently added (last 30 days)', value: 'recent' }]}
        value={filters.recentOnly ? ['recent'] : []}
        onChange={(value) => onChange({ ...filters, recentOnly: value.includes('recent') })}
        placeholder="Any time"
      />
    </div>
  );
}

export function FilterPanelFields({
  activeLabelIds,
  activeLabelOptions,
  filters,
  onChange,
  onLabelIdsChange,
}: {
  activeLabelIds: string[];
  activeLabelOptions: MultiSelectOption[];
  filters: AssetFilters;
  onChange: (next: AssetFilters) => void;
  onLabelIdsChange?: (labelIds: string[]) => void;
}) {
  return (
    <div className="space-y-6">
      {onLabelIdsChange ? (
        <LabelsField
          activeLabelIds={activeLabelIds}
          activeLabelOptions={activeLabelOptions}
          onLabelIdsChange={onLabelIdsChange}
        />
      ) : null}
      <AspectRatioField filters={filters} onChange={onChange} />
      <OrientationField filters={filters} onChange={onChange} />
      <UsageField filters={filters} onChange={onChange} />
      <AddedDateField filters={filters} onChange={onChange} />
    </div>
  );
}
