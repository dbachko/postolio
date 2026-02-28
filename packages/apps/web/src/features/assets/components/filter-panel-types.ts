import type { MultiSelectOption } from '@/components/ui/multi-select';

export type AssetFilters = {
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
};

export type FilterPanelProps = {
  filters: AssetFilters;
  labelIds?: string[];
  labelOptions?: MultiSelectOption[];
  onLabelIdsChange?: (labelIds: string[]) => void;
  onChange: (filters: AssetFilters) => void;
  onReset: () => void;
};

export const ASPECT_RATIOS = [
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

export const ORIENTATION_LABEL: Record<'portrait' | 'landscape' | 'square', string> = {
  portrait: 'Portrait',
  landscape: 'Landscape',
  square: 'Square',
};

export const USAGE_LABEL: Record<'used' | 'unused', string> = {
  used: 'Used in posts',
  unused: 'Unused',
};
