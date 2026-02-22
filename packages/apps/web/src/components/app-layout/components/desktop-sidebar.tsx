import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { SidebarNav } from '@/components/app-shell/sidebar-nav';
import { mainNavItems, secondaryNavItems } from '@/components/app-shell/nav-config';
import { brand as brandApi } from '@/lib/api';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';
import { isInboxEnabled, isSnippetsEnabled } from '@/lib/feature-flags';
import { useAuthStore } from '@/stores/authStore';
import { useBrandStore } from '@/stores/brandStore';

export function DesktopSidebar() {
  const { user, logout } = useAuthStore();
  const { selectedBrand, brands, setSelectedBrand } = useBrandStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!selectedBrand?.id) {
      return;
    }
    queryClient.prefetchQuery({
      queryKey: ['brand-social-accounts', selectedBrand.id],
      queryFn: () => brandApi.getConnectedAccounts(selectedBrand.id),
      staleTime: CACHE_TIMES.LONG,
      gcTime: GC_TIMES.LONG,
    });
  }, [queryClient, selectedBrand?.id]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const inboxEnabled = isInboxEnabled(user);
  const snippetsEnabled = isSnippetsEnabled(user);
  const visibleMainItems = mainNavItems.filter((item) => {
    if (!inboxEnabled && item.path === '/inbox') {
      return false;
    }
    if (!snippetsEnabled && item.path === '/snippets') {
      return false;
    }
    return true;
  });

  return (
    <div className="group fixed inset-y-0 left-0 z-50 hidden md:block">
      <SidebarNav
        mainItems={visibleMainItems}
        secondaryItems={secondaryNavItems}
        currentPath={location.pathname}
        userEmail={user?.email ?? null}
        brands={brands}
        selectedBrand={selectedBrand}
        onBrandSelect={(brand) => setSelectedBrand(brand)}
        onNavigate={(path) => navigate(path)}
        onLogout={handleLogout}
      />
    </div>
  );
}
