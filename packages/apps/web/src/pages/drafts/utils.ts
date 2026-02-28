import type { Asset } from '@/features/assets/api/client';
import type { Content } from '@/lib/api';

import type { DraftGroup, DraftPreview, SortDirection } from './types';

export function formatMonthLabel(date: string): string {
  return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date(date));
}

export function formatShortDateTime(date: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date));
}

export function groupDraftsByCreatedMonth(
  drafts: Content[],
  direction: SortDirection
): DraftGroup[] {
  const groupsByKey = new Map<string, DraftGroup>();
  drafts.forEach((draft) => {
    const created = new Date(draft.createdAt);
    const monthStart = new Date(created.getFullYear(), created.getMonth(), 1);
    const key = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`;
    const existing = groupsByKey.get(key);
    if (existing) {
      existing.drafts.push(draft);
      return;
    }
    groupsByKey.set(key, {
      key,
      label: formatMonthLabel(draft.createdAt),
      sortValue: monthStart.getTime(),
      drafts: [draft],
    });
  });

  return Array.from(groupsByKey.values()).sort((a, b) =>
    direction === 'asc' ? a.sortValue - b.sortValue : b.sortValue - a.sortValue
  );
}

export function getDraftPreview(primaryAsset: Asset | null): DraftPreview {
  if (!primaryAsset) {
    return { kind: 'text', url: null };
  }
  if (primaryAsset.fileType === 'video') {
    return { kind: 'video', url: primaryAsset.url, posterUrl: primaryAsset.thumbnailUrl ?? null };
  }
  return { kind: 'image', url: primaryAsset.thumbnailUrl || primaryAsset.url };
}
