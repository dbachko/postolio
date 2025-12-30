import type { ReactNode } from 'react';
import type { Content } from '@/lib/api';

export type PostStatusFilter = 'all' | 'draft' | 'scheduled' | 'published';
export type PostSortField = 'timeline' | 'created' | 'updated';
export type SortDirection = 'asc' | 'desc';

export type PostGroup = {
  key: string;
  label: string;
  sortValue: number;
  posts: Content[];
};

export interface CampaignPostsGridProps {
  title?: string;
  posts: Content[];
  isLoading?: boolean;
  isGenerating?: boolean;
  action?: ReactNode;
}
