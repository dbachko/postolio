import type { ComponentType, SVGProps } from 'react';
import { MessageCircle, Send, Bookmark } from 'lucide-react';
import type { NavigationItem } from './nav-config';

export interface SectionNavItem {
  label: string;
  path: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  description?: string;
}

const inboxSectionItems: SectionNavItem[] = [
  {
    label: 'Comments',
    path: '/inbox/comments',
    icon: MessageCircle,
    description: 'Manage post comments',
  },
  {
    label: 'Direct Messages',
    path: '/inbox/dms',
    icon: Send,
    description: 'Reply to DMs',
  },
  {
    label: 'Saved Replies',
    path: '/inbox/saved-replies',
    icon: Bookmark,
    description: 'Templates for fast responses',
  },
  {
    label: 'DM Automation',
    path: '/dm-automation',
    icon: Send,
    description: 'Automated DM responses',
  },
];

export function getSectionNavItems(section: NavigationItem | null): SectionNavItem[] {
  if (!section) return [];

  if (section.path === '/inbox') {
    return inboxSectionItems;
  }

  return [];
}
