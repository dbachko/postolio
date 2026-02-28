import type { Content } from '@/lib/api';
import type { Asset } from '@/features/assets/api/client';

export type DraftTypeFilter = 'all' | 'scheduled' | 'unscheduled';
export type DraftSortField = 'lastModified' | 'created';
export type SortDirection = 'asc' | 'desc';

export type DraftGroup = {
  key: string;
  label: string;
  sortValue: number;
  drafts: Content[];
};

export type DraftPreview =
  | {
      kind: 'video';
      url: string;
      posterUrl: string | null;
    }
  | {
      kind: 'image';
      url: string;
    }
  | {
      kind: 'text';
      url: null;
    };

export type DraftAssetMap = Record<string, Asset>;
