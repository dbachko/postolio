import { SidebarRegistry } from './registry';
import { NotificationsSidebar } from './NotificationsSidebar';
import { PostSidebar } from './PostSidebar';
import { BrandProfileSidebar } from './BrandProfileSidebar';
import { AssetSidebar } from './asset-sidebar';
import { AssetUploadSidebar } from './AssetUploadSidebar';
import { PublishingScheduleSidebar } from './PublishingScheduleSidebar';

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

SidebarRegistry['publishing-schedule'] = {
  title: 'Publishing Schedule',
  Component: PublishingScheduleSidebar,
  defaultWidthPx: 900,
};
