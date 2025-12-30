import { Link } from 'react-router-dom';
import { X } from 'lucide-react';

import type { AssetType } from '@/features/assets/api/client';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { SidebarLayout } from '../types';

type AssetSidebarHeaderProps = {
  id?: string;
  asset?: AssetType;
  layout: SidebarLayout;
  onClose: () => void;
  onOpenFullPage: () => void;
};

export function AssetSidebarHeader({
  id,
  asset,
  layout,
  onClose,
  onOpenFullPage,
}: AssetSidebarHeaderProps) {
  const headerClass = cn(
    'bg-card flex items-center justify-between border-b px-4',
    layout === 'sidebar' ? 'sticky top-0 z-30 h-12' : 'h-14 rounded-t'
  );

  return (
    <div className={headerClass}>
      {id && asset ? (
        <Breadcrumb aria-label="asset-sidebar-title">
          <BreadcrumbList>
            {layout === 'page' ? (
              <>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link to="/assets">Assets</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbItem>
                  <BreadcrumbPage>{asset.title || asset.fileName}</BreadcrumbPage>
                </BreadcrumbItem>
              </>
            ) : (
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to={`/assets/${asset.id}`} onClick={onOpenFullPage}>
                    Edit Asset
                  </Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
            )}
          </BreadcrumbList>
        </Breadcrumb>
      ) : (
        <Breadcrumb aria-label="asset-sidebar-title">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>{asset ? 'Asset' : 'Select an asset'}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )}

      {layout === 'sidebar' ? (
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close sidebar">
          <X className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}
