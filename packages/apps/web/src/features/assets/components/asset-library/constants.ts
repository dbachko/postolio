import type { AssetFilters } from '../FilterPanel';

export const COLLECTION_EXPANDED_STORAGE_KEY_PREFIX = 'asset-library:expanded-collections';
export const ROOT_COLLECTION_INLINE_PARENT_ID = '__root_collection__';
export const UNSORTED_COLLECTION_PARAM = 'unsorted';

export function getCollectionExpansionStorageKey(brandId?: string): string | undefined {
  if (!brandId) {
    return undefined;
  }
  return `${COLLECTION_EXPANDED_STORAGE_KEY_PREFIX}:${brandId}`;
}

export function createEmptyAssetFilters(): AssetFilters {
  return {
    aspectRatios: [],
    orientationTypes: [],
    usageStatuses: [],
    recentOnly: false,
  };
}
