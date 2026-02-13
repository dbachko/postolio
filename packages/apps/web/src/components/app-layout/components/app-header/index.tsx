import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';

import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { useAuthStore } from '@/stores/authStore';
import { useBrandStore } from '@/stores/brandStore';
import { usePageMeta } from '@/contexts/PageMetaContext';
import {
  allNavItems,
  isRouteActive as isRouteActiveForItem,
} from '@/components/app-shell/nav-config';
import { getSectionNavItems } from '@/components/app-shell/section-nav';
import { Button } from '@/components/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

import { AppHeaderSearchDialog } from '../app-header-search-dialog';
import { CreateActionsMenu } from './components/create-actions-menu';
import { MobileNavMenu } from './components/mobile-nav-menu';
import { MobileUserMenu } from './components/mobile-user-menu';

export function AppHeader() {
  const { user, logout } = useAuthStore();
  const { selectedBrand, brands, setSelectedBrand } = useBrandStore();
  const { openSidebar } = useRightSidebarRouter();
  const navigate = useNavigate();
  const location = useLocation();
  const { override: pageMetaOverride, setOverride: setPageMetaOverride } = usePageMeta();

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const handleLogout = useCallback(() => {
    logout();
    navigate('/login');
  }, [logout, navigate]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  useEffect(() => {
    setPageMetaOverride(null);
  }, [location.pathname, setPageMetaOverride]);

  const handleSearchSelect = useCallback(
    (path: string) => {
      navigate(path);
      setSearchOpen(false);
      setSearchQuery('');
    },
    [navigate]
  );

  const filteredItems = useMemo(
    () =>
      allNavItems.filter(
        (item) =>
          item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.description?.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [searchQuery]
  );

  const pageMeta = useMemo(() => {
    const path = location.pathname;

    if (path === '/' || path === '/dashboard') {
      return {
        title: 'Dashboard',
        description: 'Overview of your brands and recent activity',
      };
    }

    const matchedPrimary =
      allNavItems.find((item) => isRouteActiveForItem(item, path)) ??
      allNavItems.find((item) => path.startsWith(item.path + '/'));

    if (matchedPrimary) {
      const sectionChildren = getSectionNavItems(matchedPrimary);
      const matchedChild =
        sectionChildren.find((child) => path === child.path) ??
        sectionChildren.find((child) => path.startsWith(child.path + '/'));

      if (matchedChild) {
        if (matchedChild.path === matchedPrimary.path) {
          return {
            title: matchedPrimary.label,
            description: matchedChild.description ?? matchedPrimary.description,
          };
        }

        return { title: matchedChild.label, description: matchedChild.description };
      }

      return { title: matchedPrimary.label, description: matchedPrimary.description };
    }

    const last = path.split('/').filter(Boolean).pop();
    const title = last ? last.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Page';
    return { title, description: undefined };
  }, [location.pathname]);

  const effectivePageMeta = useMemo(() => {
    if (!pageMetaOverride) return pageMeta;
    return {
      title: pageMetaOverride.title ?? pageMeta.title,
      description: pageMetaOverride.description ?? pageMeta.description,
    };
  }, [pageMeta, pageMetaOverride]);

  const headerBreadcrumbs = useMemo(() => {
    const path = location.pathname;
    if (path === '/skills' || path.startsWith('/skills/')) {
      return [{ label: 'Recipes', to: '/recipes' }, { label: 'Skills' }];
    }
    if (path === '/runs') {
      return [{ label: 'Recipes', to: '/recipes' }, { label: 'History' }];
    }
    if (path.startsWith('/runs/')) {
      return [
        { label: 'Recipes', to: '/recipes' },
        { label: 'History', to: '/runs' },
        { label: 'Generation' },
      ];
    }
    if (path === '/series') {
      return [{ label: 'Recipes', to: '/recipes' }, { label: 'Series' }];
    }
    if (path.startsWith('/series/')) {
      return [
        { label: 'Recipes', to: '/recipes' },
        { label: 'Series', to: '/series' },
        { label: 'Details' },
      ];
    }
    return null;
  }, [location.pathname]);

  return (
    <>
      <header className="bg-card sticky top-0 z-40 border-b">
        <div className="flex h-12 items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to="/dashboard"
              className="flex items-center space-x-2 md:hidden"
              aria-label="Postolio home"
            >
              <img src="/postolio-icon.svg" alt="" className="h-7 w-7" aria-hidden="true" />
              <h1 className="text-foreground text-lg font-bold">Postolio</h1>
            </Link>

            <div className="hidden min-w-0 flex-col md:flex">
              {headerBreadcrumbs ? (
                <Breadcrumb>
                  <BreadcrumbList className="text-foreground gap-1 text-sm font-semibold">
                    {headerBreadcrumbs.map((item, index) => (
                      <Fragment key={`${item.label}-${index}`}>
                        {index > 0 ? <BreadcrumbSeparator /> : null}
                        <BreadcrumbItem>
                          {item.to ? (
                            <BreadcrumbLink
                              asChild
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <Link to={item.to}>{item.label}</Link>
                            </BreadcrumbLink>
                          ) : (
                            <span className="text-foreground">{item.label}</span>
                          )}
                        </BreadcrumbItem>
                      </Fragment>
                    ))}
                  </BreadcrumbList>
                </Breadcrumb>
              ) : (
                <h1 className="text-foreground truncate text-sm font-semibold">
                  {effectivePageMeta.title}
                </h1>
              )}
              {effectivePageMeta.description ? (
                <p className="text-muted-foreground truncate text-xs">
                  {effectivePageMeta.description}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hidden h-9 items-center sm:flex"
              onClick={() => setSearchOpen(true)}
              aria-label="Search (Press ⌘K)"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              <span className="ml-2 hidden text-sm lg:inline">Search</span>
              <kbd className="bg-muted pointer-events-none ml-2 hidden h-5 items-center gap-1 rounded border px-1.5 font-mono text-[10px] font-medium opacity-100 select-none lg:inline-flex">
                <span className="text-xs">⌘</span>K
              </kbd>
            </Button>

            <CreateActionsMenu
              selectedBrandId={selectedBrand?.id ?? null}
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
        </div>
      </header>

      <AppHeaderSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        filteredItems={filteredItems}
        onSelectPath={handleSearchSelect}
      />
    </>
  );
}
