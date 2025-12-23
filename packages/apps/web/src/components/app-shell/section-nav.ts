import type { ComponentType, SVGProps } from 'react';
import { MessageCircle, Send, Bookmark, Plug, CalendarClock } from 'lucide-react';
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

const socialAccountsSectionItems: SectionNavItem[] = [
  {
    label: 'Connections',
    path: '/social-accounts/connections',
    icon: Plug,
    description: 'Connect and manage accounts',
  },
  {
    label: 'Publishing Schedule',
    path: '/social-accounts/publishing-schedule',
    icon: CalendarClock,
    description: 'Configure recurring publishing time slots',
  },
];

export function getSectionNavItems(section: NavigationItem | null): SectionNavItem[] {
  if (!section) return [];

  if (section.path === '/inbox') {
    return inboxSectionItems;
  }

  if (section.path === '/social-accounts') {
    return socialAccountsSectionItems;
  }

  return [];
}
