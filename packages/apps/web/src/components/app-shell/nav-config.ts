import {
  BarChart3,
  ClipboardList,
  FileEdit,
  FileText,
  Images,
  Megaphone,
  MessageSquare,
  Send,
  Settings,
  Users,
} from 'lucide-react';

export type NavMatchType = 'exact' | 'startsWith';

export interface NavigationItem {
  label: string;
  path: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  description?: string;
  matchType?: NavMatchType;
}

// Primary application sections shown in the main navigation.
export const mainNavItems: NavigationItem[] = [
  {
    label: 'Content',
    path: '/content',
    icon: FileText,
    description: 'Content library',
    matchType: 'exact',
  },
  {
    label: 'Drafts',
    path: '/drafts',
    icon: FileEdit,
    description: 'Work-in-progress posts',
    matchType: 'exact',
  },
  {
    label: 'Assets',
    path: '/assets',
    icon: Images,
    description: 'Media library',
    matchType: 'exact',
  },
  {
    label: 'Snippets',
    path: '/snippets',
    icon: ClipboardList,
    description: 'Reusable caption snippets',
    matchType: 'exact',
  },
  {
    label: 'Campaigns',
    path: '/campaigns',
    icon: Megaphone,
    description: 'Manage content campaigns',
    matchType: 'startsWith',
  },
  {
    label: 'Inbox',
    path: '/inbox',
    icon: MessageSquare,
    description: 'Comments & DMs',
    matchType: 'startsWith',
  },
  {
    label: 'Analytics',
    path: '/analytics',
    icon: BarChart3,
    description: 'Performance metrics',
    matchType: 'exact',
  },
];

// Secondary destinations that live in the lower portion of the nav.
export const secondaryNavItems: NavigationItem[] = [
  {
    label: 'Social Accounts',
    path: '/social-accounts',
    icon: Users,
    description: 'Connect accounts and set publishing schedules',
    matchType: 'startsWith',
  },
  {
    label: 'Settings',
    path: '/settings',
    icon: Settings,
    description: 'Account & workspace settings',
    matchType: 'exact',
  },
];

// Items that should be searchable / discoverable but not shown in the primary sidebar list.
export const auxNavItems: NavigationItem[] = [
  {
    label: 'DM Automation',
    path: '/dm-automation',
    icon: Send,
    description: 'Automated DM responses',
    matchType: 'exact',
  },
];

export const allNavItems: NavigationItem[] = [
  ...mainNavItems,
  ...secondaryNavItems,
  ...auxNavItems,
];

export const isRouteActive = (item: NavigationItem, currentPath: string): boolean => {
  if (item.matchType === 'startsWith') {
    return currentPath === item.path || currentPath.startsWith(item.path + '/');
  }
  return currentPath === item.path;
};
import type { ComponentType, SVGProps } from 'react';
