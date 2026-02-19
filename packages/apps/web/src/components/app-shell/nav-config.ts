import {
  BarChart3,
  BookOpen,
  CalendarClock,
  ClipboardList,
  FileEdit,
  FileText,
  Images,
  Layers,
  MessageSquare,
  PlayCircle,
  Plug,
  Send,
  Settings,
  Wrench,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

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
    label: 'Recipes',
    path: '/recipes',
    icon: BookOpen,
    description: 'Reusable workflows',
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
    label: 'Schedule',
    path: '/social-accounts/publishing-schedule',
    icon: CalendarClock,
    description: 'Manage publishing queue schedules',
    matchType: 'exact',
  },
  {
    label: 'Settings',
    path: '/settings',
    icon: Settings,
    description: 'Account & workspace settings',
    matchType: 'startsWith',
  },
];

// Items that should be searchable / discoverable but not shown in the primary sidebar list.
export const auxNavItems: NavigationItem[] = [
  {
    label: 'Connections',
    path: '/settings/social-accounts',
    icon: Plug,
    description: 'Connect and manage social accounts',
    matchType: 'exact',
  },
  {
    label: 'DM Automation',
    path: '/dm-automation',
    icon: Send,
    description: 'Automated DM responses',
    matchType: 'exact',
  },
  {
    label: 'Skills',
    path: '/skills',
    icon: Wrench,
    description: 'Configure skills and BYOK',
    matchType: 'exact',
  },
  {
    label: 'Series',
    path: '/series',
    icon: Layers,
    description: 'Generated post groups',
    matchType: 'startsWith',
  },
  {
    label: 'History',
    path: '/runs',
    icon: PlayCircle,
    description: 'Generation history',
    matchType: 'startsWith',
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
