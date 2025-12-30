export type SidebarLayout = 'sidebar' | 'page';

export type AssetSidebarProps = {
  id?: string;
  layout?: SidebarLayout;
  onClose?: () => void;
  showHeader?: boolean;
};

export type AssetFormState = {
  title: string;
  altText: string;
};

export type AssetProbeResult = {
  width?: number;
  height?: number;
  duration?: number;
};

export type DerivedAssetDisplay = {
  fileSize: string;
  createdAt: string;
  updatedAt: string;
  extension: string;
};
