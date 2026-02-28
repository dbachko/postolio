import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { ORIENTATION_LABEL, USAGE_LABEL, type AssetFilters } from './filter-panel-types';

type AppliedFilter = {
  key: string;
  label: string;
  onRemove: () => void;
};

function AppliedFilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 rounded-full px-3"
      onClick={onRemove}
    >
      {label}
      <X className="ml-1 h-3.5 w-3.5" />
    </Button>
  );
}

function createPrimaryChips({
  activeLabelIds,
  filters,
  labelNameById,
  onChange,
  onLabelIdsChange,
}: {
  activeLabelIds: string[];
  filters: AssetFilters;
  labelNameById: Map<string, string>;
  onChange: (filters: AssetFilters) => void;
  onLabelIdsChange?: (labelIds: string[]) => void;
}) {
  const chips: AppliedFilter[] = [];

  if (onLabelIdsChange) {
    chips.push(
      ...activeLabelIds.map((labelId) => ({
        key: `chip-label-${labelId}`,
        label: `Label: ${labelNameById.get(labelId) ?? labelId}`,
        onRemove: () => onLabelIdsChange(activeLabelIds.filter((item) => item !== labelId)),
      }))
    );
  }

  chips.push(
    ...filters.aspectRatios.map((ratio) => ({
      key: `chip-ratio-${ratio}`,
      label: `Ratio: ${ratio}`,
      onRemove: () =>
        onChange({
          ...filters,
          aspectRatios: filters.aspectRatios.filter((item) => item !== ratio),
        }),
    })),
    ...filters.orientationTypes.map((orientation) => ({
      key: `chip-orientation-${orientation}`,
      label: ORIENTATION_LABEL[orientation],
      onRemove: () =>
        onChange({
          ...filters,
          orientationTypes: filters.orientationTypes.filter((item) => item !== orientation),
        }),
    })),
    ...filters.usageStatuses.map((usage) => ({
      key: `chip-usage-${usage}`,
      label: USAGE_LABEL[usage],
      onRemove: () =>
        onChange({
          ...filters,
          usageStatuses: filters.usageStatuses.filter((item) => item !== usage),
        }),
    }))
  );

  if (filters.recentOnly) {
    chips.push({
      key: 'chip-recent',
      label: 'Recently added',
      onRemove: () => onChange({ ...filters, recentOnly: false }),
    });
  }

  return chips;
}

function createSecondaryChips({
  filters,
  onChange,
}: {
  filters: AssetFilters;
  onChange: (filters: AssetFilters) => void;
}) {
  const chips: AppliedFilter[] = [];
  const numericFilters: Array<{ key: string; label: string; onRemove: () => void }> = [
    {
      key: 'chip-min-width',
      label: `Min width: ${filters.minWidth}`,
      onRemove: () => onChange({ ...filters, minWidth: undefined }),
    },
    {
      key: 'chip-max-width',
      label: `Max width: ${filters.maxWidth}`,
      onRemove: () => onChange({ ...filters, maxWidth: undefined }),
    },
    {
      key: 'chip-min-height',
      label: `Min height: ${filters.minHeight}`,
      onRemove: () => onChange({ ...filters, minHeight: undefined }),
    },
    {
      key: 'chip-max-height',
      label: `Max height: ${filters.maxHeight}`,
      onRemove: () => onChange({ ...filters, maxHeight: undefined }),
    },
  ];

  chips.push(...numericFilters.filter((item) => !item.label.endsWith('undefined')));

  if (filters.uploadedAfter) {
    chips.push({
      key: 'chip-uploaded-after',
      label: `Uploaded after: ${filters.uploadedAfter}`,
      onRemove: () => onChange({ ...filters, uploadedAfter: undefined }),
    });
  }
  if (filters.uploadedBefore) {
    chips.push({
      key: 'chip-uploaded-before',
      label: `Uploaded before: ${filters.uploadedBefore}`,
      onRemove: () => onChange({ ...filters, uploadedBefore: undefined }),
    });
  }

  return chips;
}

function createAppliedFilters({
  activeLabelIds,
  filters,
  labelNameById,
  onChange,
  onLabelIdsChange,
}: {
  activeLabelIds: string[];
  filters: AssetFilters;
  labelNameById: Map<string, string>;
  onChange: (filters: AssetFilters) => void;
  onLabelIdsChange?: (labelIds: string[]) => void;
}) {
  return [
    ...createPrimaryChips({
      activeLabelIds,
      filters,
      labelNameById,
      onChange,
      onLabelIdsChange,
    }),
    ...createSecondaryChips({ filters, onChange }),
  ];
}

export function FilterPanelAppliedFilters({
  activeLabelIds,
  filters,
  labelNameById,
  onChange,
  onLabelIdsChange,
}: {
  activeLabelIds: string[];
  filters: AssetFilters;
  labelNameById: Map<string, string>;
  onChange: (filters: AssetFilters) => void;
  onLabelIdsChange?: (labelIds: string[]) => void;
}) {
  const chips = createAppliedFilters({
    activeLabelIds,
    filters,
    labelNameById,
    onChange,
    onLabelIdsChange,
  });

  if (chips.length === 0) {
    return null;
  }

  return (
    <div className="mb-4 rounded-lg border p-3">
      <div className="mb-2 text-sm font-semibold">Applied filters</div>
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <AppliedFilterChip key={chip.key} label={chip.label} onRemove={chip.onRemove} />
        ))}
      </div>
    </div>
  );
}
