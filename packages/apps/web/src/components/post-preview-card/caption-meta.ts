import type { CalendarItem } from '@/types/calendar';

export function getPostCardCaptionMeta(item: CalendarItem): { text: string; isFallback: boolean } {
  if (item.type === 'placeholder') return { text: '\u00A0', isFallback: false };
  const record = item as unknown as Record<string, unknown>;

  const rawCaption = typeof record.caption === 'string' ? record.caption : '';
  const caption = rawCaption.trim();
  if (caption.length > 0) return { text: caption, isFallback: false };

  const rawType = typeof record.contentType === 'string' ? record.contentType : '';
  const contentType = rawType.trim().toLowerCase();
  if (contentType === 'reel') return { text: 'Untitled reel', isFallback: true };
  if (contentType === 'story') return { text: 'Untitled story', isFallback: true };
  return { text: 'Untitled post', isFallback: true };
}
