import type { InboxItem } from './types';

export function matchesQuery(value: string, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  return value.toLowerCase().includes(normalizedQuery);
}

export function getInboxItemKey(item: InboxItem): string {
  return item.type === 'dm_conversation' ? `dm:${item.conversationId}` : `c:${item.publicationId}`;
}

export function parseInboxItemKey(itemKey: string): { kind: 'dm' | 'comment'; id: string } | null {
  if (itemKey.startsWith('dm:')) {
    return { kind: 'dm', id: itemKey.slice('dm:'.length) };
  }
  if (itemKey.startsWith('c:')) {
    return { kind: 'comment', id: itemKey.slice('c:'.length) };
  }
  return null;
}
