import type { Content } from '@/lib/api';
import type { PlaceholderItem } from '../types';

export interface FullCalendarProps {
  brandId: string;
  brandTimezone: string;
  view: 'month' | 'week';
  date: Date;
  content?: Content[];
  placeholders?: PlaceholderItem[];
  targetSocialAccountIds?: string[] | null;
  theme?: 'default' | 'monarch';
}
