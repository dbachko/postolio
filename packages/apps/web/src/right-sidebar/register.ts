import { SidebarRegistry } from './registry';
import { NotificationsSidebar } from './NotificationsSidebar';
import { PostSidebar } from './PostSidebar';

// Register built-in sidebars
SidebarRegistry['notifications'] = {
  title: 'Notifications',
  Component: NotificationsSidebar,
  defaultWidthPx: 460,
};

SidebarRegistry['post'] = {
  title: 'Post',
  Component: PostSidebar,
  defaultWidthPx: 560,
};
