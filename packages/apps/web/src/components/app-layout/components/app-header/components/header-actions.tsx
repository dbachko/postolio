import { Search } from 'lucide-react';
import type { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import type { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import type { AuthState } from '@/stores/authStore';
import type { BrandState } from '@/stores/brandStore';
import { CreateActionsMenu } from './create-actions-menu';
import { MobileNavMenu } from './mobile-nav-menu';
import { MobileUserMenu } from './mobile-user-menu';

interface HeaderActionsProps {
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  selectedBrandId: string | null;
  openSidebar: ReturnType<typeof useRightSidebarRouter>['openSidebar'];
  user: AuthState['user'];
  brands: BrandState['brands'];
  selectedBrand: BrandState['selectedBrand'];
  setSelectedBrand: BrandState['setSelectedBrand'];
  navigate: ReturnType<typeof useNavigate>;
  handleLogout: () => void;
}

export function HeaderActions({
  searchOpen,
  setSearchOpen,
  selectedBrandId,
  openSidebar,
  user,
  brands,
  selectedBrand,
  setSelectedBrand,
  navigate,
  handleLogout,
}: HeaderActionsProps) {
  return (
    <div className="flex items-center space-x-2">
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hidden h-9 items-center sm:flex"
        onClick={() => setSearchOpen(!searchOpen)}
        aria-label="Search (Press ⌘K)"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        <span className="ml-2 hidden text-sm lg:inline">Search</span>
        <kbd className="bg-muted pointer-events-none ml-2 hidden h-5 items-center gap-1 rounded border px-1.5 font-mono text-[10px] font-medium opacity-100 select-none lg:inline-flex">
          <span className="text-xs">⌘</span>K
        </kbd>
      </Button>
      <CreateActionsMenu
        selectedBrandId={selectedBrandId}
        onCreatePost={() => openSidebar('post-create')}
        onUploadAsset={(brandId) => openSidebar('asset-upload', { id: brandId })}
      />
      <MobileNavMenu />
      {user ? (
        <MobileUserMenu
          userEmail={user.email}
          brands={brands}
          selectedBrand={selectedBrand}
          onSelectBrand={setSelectedBrand}
          onNavigate={(path) => navigate(path)}
          onLogout={handleLogout}
        />
      ) : null}
    </div>
  );
}
