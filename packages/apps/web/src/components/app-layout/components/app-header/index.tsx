import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { useAuthStore, type AuthState } from '@/stores/authStore';
import { useBrandStore } from '@/stores/brandStore';
import { usePageMeta } from '@/contexts/PageMetaContext';
import { isInboxEnabled, isSnippetsEnabled } from '@/lib/feature-flags';
import {
  allNavItems,
  isRouteActive as isRouteActiveForItem,
} from '@/components/app-shell/nav-config';
import { getSectionNavItems } from '@/components/app-shell/section-nav';
import { AppHeaderSearchDialog } from '../app-header-search-dialog';
import { HeaderActions } from './components/header-actions';
import { HeaderIdentity, type HeaderBreadcrumb } from './components/header-identity';

function useHeaderSearch({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const handleSearchSelect = useCallback(
    (path: string) => {
      navigate(path);
      setSearchOpen(false);
      setSearchQuery('');
    },
    [navigate]
  );

  return { searchOpen, setSearchOpen, searchQuery, setSearchQuery, handleSearchSelect };
}

function useVisibleNavItems(user: AuthState['user']) {
  const inboxEnabled = isInboxEnabled(user);
  const snippetsEnabled = isSnippetsEnabled(user);
  return useMemo(
    () =>
      allNavItems.filter((item) => {
        if (!inboxEnabled && (item.path === '/inbox' || item.path === '/dm-automation')) {
          return false;
        }
        if (!snippetsEnabled && item.path === '/snippets') {
          return false;
        }
        return true;
      }),
    [inboxEnabled, snippetsEnabled]
  );
}

function useHeaderMeta({
  pathname,
  visibleNavItems,
  pageMetaOverride,
}: {
  pathname: string;
  visibleNavItems: typeof allNavItems;
  pageMetaOverride: { title?: string; description?: string } | null;
}) {
  const pageMeta = useMemo(() => {
    if (pathname === '/' || pathname === '/dashboard') {
      return { title: 'Dashboard', description: 'Overview of your brands and recent activity' };
    }
    const matchedPrimary =
      visibleNavItems.find((item) => isRouteActiveForItem(item, pathname)) ??
      visibleNavItems.find((item) => pathname.startsWith(`${item.path}/`));
    if (!matchedPrimary) {
      const last = pathname.split('/').filter(Boolean).pop();
      const title = last
        ? last.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
        : 'Page';
      return { title, description: undefined };
    }
    const sectionChildren = getSectionNavItems(matchedPrimary);
    const matchedChild =
      sectionChildren.find((child) => pathname === child.path) ??
      sectionChildren.find((child) => pathname.startsWith(`${child.path}/`));
    if (!matchedChild) {
      return { title: matchedPrimary.label, description: matchedPrimary.description };
    }
    if (matchedChild.path === matchedPrimary.path) {
      return {
        title: matchedPrimary.label,
        description: matchedChild.description ?? matchedPrimary.description,
      };
    }
    return { title: matchedChild.label, description: matchedChild.description };
  }, [pathname, visibleNavItems]);

  const effectivePageMeta = useMemo(() => {
    if (!pageMetaOverride) {
      return pageMeta;
    }
    return {
      title: pageMetaOverride.title ?? pageMeta.title,
      description: pageMetaOverride.description ?? pageMeta.description,
    };
  }, [pageMeta, pageMetaOverride]);

  const headerBreadcrumbs = useMemo<HeaderBreadcrumb[] | null>(() => {
    if (pathname === '/skills' || pathname.startsWith('/skills/')) {
      return [{ label: 'Recipes', to: '/recipes' }, { label: 'Skills' }];
    }
    if (pathname === '/runs') {
      return [{ label: 'Recipes', to: '/recipes' }, { label: 'History' }];
    }
    if (pathname.startsWith('/runs/')) {
      return [
        { label: 'Recipes', to: '/recipes' },
        { label: 'History', to: '/runs' },
        { label: 'Generation' },
      ];
    }
    if (pathname === '/series') {
      return [{ label: 'Recipes', to: '/recipes' }, { label: 'Series' }];
    }
    if (pathname.startsWith('/series/')) {
      return [
        { label: 'Recipes', to: '/recipes' },
        { label: 'Series', to: '/series' },
        { label: 'Details' },
      ];
    }
    return null;
  }, [pathname]);

  return { effectivePageMeta, headerBreadcrumbs };
}

interface AppHeaderViewProps {
  headerBreadcrumbs: HeaderBreadcrumb[] | null;
  title: string;
  description?: string;
  actions: React.ReactNode;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  filteredItems: typeof allNavItems;
  onSelectPath: (path: string) => void;
}

function AppHeaderView({
  headerBreadcrumbs,
  title,
  description,
  actions,
  searchOpen,
  setSearchOpen,
  searchQuery,
  setSearchQuery,
  filteredItems,
  onSelectPath,
}: AppHeaderViewProps) {
  return (
    <>
      <header className="bg-card sticky top-0 z-40 border-b">
        <div className="flex h-12 items-center justify-between px-4 sm:px-6 lg:px-8">
          <HeaderIdentity
            headerBreadcrumbs={headerBreadcrumbs}
            title={title}
            description={description}
          />
          {actions}
        </div>
      </header>
      <AppHeaderSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        filteredItems={filteredItems}
        onSelectPath={onSelectPath}
      />
    </>
  );
}

export function AppHeader() {
  const { user, logout } = useAuthStore();
  const { selectedBrand, brands, setSelectedBrand } = useBrandStore();
  const { openSidebar } = useRightSidebarRouter();
  const navigate = useNavigate();
  const location = useLocation();
  const { override: pageMetaOverride, setOverride: setPageMetaOverride } = usePageMeta();

  const { searchOpen, setSearchOpen, searchQuery, setSearchQuery, handleSearchSelect } =
    useHeaderSearch({
      navigate,
    });
  const visibleNavItems = useVisibleNavItems(user);
  const filteredItems = useMemo(
    () =>
      visibleNavItems.filter(
        (item) =>
          item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.description?.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [searchQuery, visibleNavItems]
  );
  const { effectivePageMeta, headerBreadcrumbs } = useHeaderMeta({
    pathname: location.pathname,
    visibleNavItems,
    pageMetaOverride,
  });
  const handleLogout = useCallback(() => {
    logout();
    navigate('/login');
  }, [logout, navigate]);

  useEffect(() => {
    setPageMetaOverride(null);
  }, [location.pathname, setPageMetaOverride]);

  const actions = (
    <HeaderActions
      searchOpen={searchOpen}
      setSearchOpen={setSearchOpen}
      selectedBrandId={selectedBrand?.id ?? null}
      openSidebar={openSidebar}
      user={user}
      brands={brands}
      selectedBrand={selectedBrand}
      setSelectedBrand={setSelectedBrand}
      navigate={navigate}
      handleLogout={handleLogout}
    />
  );

  return (
    <AppHeaderView
      headerBreadcrumbs={headerBreadcrumbs}
      title={effectivePageMeta.title}
      description={effectivePageMeta.description}
      actions={actions}
      searchOpen={searchOpen}
      setSearchOpen={setSearchOpen}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      filteredItems={filteredItems}
      onSelectPath={handleSearchSelect}
    />
  );
}
