import { useEffect, useState } from 'react';
import type { AssetType } from '@/features/assets/api/client';

export type AssetTypeFilter = 'all' | 'image' | 'video';
export type SortField = 'created' | 'size' | 'title';
export type SortDirection = 'asc' | 'desc';

export function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced as T;
}

export const formatBytes = (bytes?: number | null) => {
  if (!bytes && bytes !== 0) {
    return '—';
  }
  if (bytes === 0) {
    return '0 B';
  }
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
};

export const formatMonthLabel = (date: string) =>
  new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date(date));

export const sortAssets = (assets: AssetType[], field: SortField, direction: SortDirection) => {
  const multiplier = direction === 'asc' ? 1 : -1;
  return [...assets].sort((a, b) => {
    const createdA = new Date(a.createdAt).getTime();
    const createdB = new Date(b.createdAt).getTime();
    const sizeA = a.fileSize || 0;
    const sizeB = b.fileSize || 0;
    const titleA = (a.title || a.fileName || '').toLowerCase();
    const titleB = (b.title || b.fileName || '').toLowerCase();

    switch (field) {
      case 'created':
        return (createdA - createdB) * multiplier;
      case 'size':
        return (sizeA - sizeB) * multiplier;
      case 'title':
        return titleA.localeCompare(titleB) * multiplier;
      default:
        return 0;
    }
  });
};

export const groupByMonth = (assets: AssetType[]) => {
  const grouped: Record<string, AssetType[]> = {};
  for (const asset of assets) {
    const key = formatMonthLabel(asset.createdAt);
    grouped[key] = grouped[key] ? [...grouped[key], asset] : [asset];
  }
  return grouped;
};
