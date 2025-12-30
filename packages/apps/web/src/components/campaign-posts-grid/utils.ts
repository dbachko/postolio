import type { Asset } from '@/features/assets/api/client';
import type { Content } from '@/lib/api';
import type { PostGroup, PostSortField, SortDirection } from './types';

const formatMonthLabel = (date: string) =>
  new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date(date));

export const formatShortDateTime = (date: string) =>
  new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date));

export const getSortingDate = (post: Content, sortField: PostSortField) => {
  if (sortField === 'created') return post.createdAt;
  if (sortField === 'updated') return post.updatedAt || post.createdAt;
  return post.scheduledAt || post.postedAt || post.createdAt;
};

export const groupPostsByMonth = (
  posts: Content[],
  sortField: PostSortField,
  direction: SortDirection
) => {
  const groupsByKey = new Map<string, PostGroup>();

  posts.forEach((post) => {
    const date = new Date(getSortingDate(post, sortField));
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    const key = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`;

    const existing = groupsByKey.get(key);
    if (existing) {
      existing.posts.push(post);
      return;
    }

    groupsByKey.set(key, {
      key,
      label: formatMonthLabel(getSortingDate(post, sortField)),
      sortValue: monthStart.getTime(),
      posts: [post],
    });
  });

  return Array.from(groupsByKey.values()).sort((a, b) =>
    direction === 'asc' ? a.sortValue - b.sortValue : b.sortValue - a.sortValue
  );
};

export type PostPreview =
  | { kind: 'video'; url: string; posterUrl: string | null }
  | { kind: 'image'; url: string }
  | { kind: 'text'; url: null };

export const getPostPreview = (primaryAsset: Asset | null): PostPreview => {
  if (!primaryAsset) {
    return { kind: 'text', url: null };
  }

  if (primaryAsset.fileType === 'video') {
    return {
      kind: 'video',
      url: primaryAsset.url,
      posterUrl: primaryAsset.thumbnailUrl ?? null,
    };
  }

  const url = primaryAsset.thumbnailUrl || primaryAsset.url;
  return { kind: 'image', url };
};
