import { SidebarRegistry } from './registry';
import { NotificationsSidebar } from './NotificationsSidebar';
import { PostSidebar } from './PostSidebar';
import { BrandProfileSidebar } from './BrandProfileSidebar';
import { AssetSidebar } from './AssetSidebar';
import { AssetUploadSidebar } from './AssetUploadSidebar';
import { WeeklyCalendarSidebar } from './WeeklyCalendarSidebar';

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

SidebarRegistry['post-create'] = {
  title: 'New Post',
  Component: PostSidebar,
  defaultWidthPx: 560,
};

SidebarRegistry['brand-profile'] = {
  title: 'Brand Profile',
  Component: BrandProfileSidebar,
  defaultWidthPx: 460,
};

SidebarRegistry['asset'] = {
  title: 'Edit Asset',
  Component: AssetSidebar,
  defaultWidthPx: 640,
};

SidebarRegistry['asset-upload'] = {
  title: 'Upload Assets',
  Component: AssetUploadSidebar,
  defaultWidthPx: 560,
};

SidebarRegistry['weekly-calendar'] = {
  title: 'Weekly Calendar',
  Component: WeeklyCalendarSidebar,
  defaultWidthPx: 900,
};
