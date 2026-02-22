import type { ComponentType, SVGProps } from 'react';
import {
  BarChart3,
  Bell,
  Bookmark,
  CreditCard,
  Inbox,
  Palette,
  Plug,
  Send,
  SlidersHorizontal,
  UserRound,
} from 'lucide-react';
import type { NavigationItem } from './nav-config';

export interface SectionNavItem {
  label: string;
  path: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  description?: string;
}

const inboxSectionItems: SectionNavItem[] = [
  {
    label: 'Incoming',
    path: '/inbox',
    icon: Inbox,
    description: 'All incoming messages and comments',
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

const settingsSectionItems: SectionNavItem[] = [
  {
    label: 'General',
    path: '/settings',
    icon: SlidersHorizontal,
    description: 'Timezone, calendar, and brand defaults',
  },
  {
    label: 'Notifications',
    path: '/settings/notifications',
    icon: Bell,
    description: 'Control alerts by channel and category',
  },
  {
    label: 'Appearance',
    path: '/settings/appearance',
    icon: Palette,
    description: 'Theme and display preferences',
  },
  {
    label: 'Account',
    path: '/settings/account',
    icon: UserRound,
    description: 'Account lifecycle and data controls',
  },
  {
    label: 'Image Analytics',
    path: '/settings/analytics',
    icon: BarChart3,
    description: 'AI image usage, performance, and costs',
  },
  {
    label: 'Billing',
    path: '/settings/billing',
    icon: CreditCard,
    description: 'Subscription, invoices, payment methods, and credits',
  },
  {
    label: 'Social Accounts',
    path: '/settings/social-accounts',
    icon: Plug,
    description: 'Connect and manage social destinations',
  },
];

export function getSectionNavItems(section: NavigationItem | null): SectionNavItem[] {
  if (!section) {
    return [];
  }

  if (section.path === '/inbox') {
    return inboxSectionItems;
  }

  if (section.path === '/settings') {
    return settingsSectionItems;
  }

  return [];
}
