import { useState, type ReactNode, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { EmailVerificationBanner } from './EmailVerificationBanner';
import { DemoModeBanner } from './DemoModeBanner';
import { ScheduleLimitBanner } from './ScheduleLimitBanner';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Building2,
  ChevronDown,
  Grid3X3,
  Home,
  LogOut,
  Megaphone,
  Plus,
  Search,
  Settings,
  Shield,
  Sparkles,
  Upload,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { WizardHelpDialog } from './campaign-wizard/shared/WizardHelpDialog';
import { RightHelpDrawer } from './help/RightHelpDrawer';
import { RightSidebarRoot } from '@/right-sidebar/RightSidebarRoot';
import '@/right-sidebar/register';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { useAuthStore } from '../stores/authStore';
import { useBrandStore } from '../stores/brandStore';
import { PageMetaProvider, usePageMeta } from '@/contexts/PageMetaContext';
import {
  allNavItems,
  isRouteActive as isRouteActiveForItem,
  mainNavItems,
  secondaryNavItems,
  type NavigationItem,
} from './app-shell/nav-config';
import { getSectionNavItems } from './app-shell/section-nav';
import { SidebarNav } from './app-shell/sidebar-nav';

interface LayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: LayoutProps) {
  return (
    <PageMetaProvider>
      <AppLayoutInner>{children}</AppLayoutInner>
    </PageMetaProvider>
  );
}

function AppLayoutInner({ children }: LayoutProps) {
  const { user, logout } = useAuthStore();
  const { selectedBrand, brands, setSelectedBrand } = useBrandStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { override: pageMetaOverride, setOverride: setPageMetaOverride } = usePageMeta();

  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpDrawerOpen, setHelpDrawerOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { openSidebar } = useRightSidebarRouter();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isActiveRoute = useCallback(
    (item: NavigationItem) => {
      return isRouteActiveForItem(item, location.pathname);
    },
    [location.pathname]
  );

  // Command palette keyboard shortcut
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

  // Close mobile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [menuOpen]);

  // Close menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [location]);

  // Clear per-page title overrides on navigation
  useEffect(() => {
    setPageMetaOverride(null);
  }, [location.pathname, setPageMetaOverride]);

  // Handle search selection
  const handleSearchSelect = useCallback(
    (path: string) => {
      navigate(path);
      setSearchOpen(false);
      setSearchQuery('');
    },
    [navigate]
  );

  // Filter navigation items based on search query
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
        return { title: matchedChild.label, description: matchedChild.description };
      }

      return { title: matchedPrimary.label, description: matchedPrimary.description };
    }

    // Fallback: derive title from last segment
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

  return (
    <div className="bg-background flex min-h-screen">
      {/* Skip to main content for accessibility */}
      <a
        href="#main-content"
        className="bg-primary text-primary-foreground sr-only z-50 rounded-md px-4 py-2 focus:not-sr-only focus:absolute focus:top-4 focus:left-4"
      >
        Skip to main content
      </a>

      {/* Left hover-expandable navigation (desktop) */}
      <div className="group fixed inset-y-0 left-0 z-50 hidden md:block">
        <SidebarNav
          mainItems={mainNavItems}
          secondaryItems={secondaryNavItems}
          currentPath={location.pathname}
          userEmail={user?.email ?? null}
          brands={brands}
          selectedBrand={selectedBrand}
          onBrandSelect={(brand) => setSelectedBrand(brand)}
          onNavigate={(path) => navigate(path)}
          onLogout={handleLogout}
        />
        {/* Dim main content slightly when sidebar is hovered (OpenSea-style) */}
        <div className="pointer-events-none fixed inset-0 z-40 bg-transparent transition-colors duration-300 ease-out group-hover:bg-black/25" />
      </div>

      {/* Main column: banners, top bar, content, footer */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col md:pl-[52px]">
        {/* Banners above top bar */}
        <EmailVerificationBanner />
        <DemoModeBanner />
        <ScheduleLimitBanner />

        {/* Top bar */}
        <header className="bg-card sticky top-0 z-40 border-b">
          <div className="flex h-12 items-center justify-between px-4 sm:px-6 lg:px-8">
            {/* Left: Page title + help text */}
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
                <h1 className="text-foreground truncate text-sm font-semibold">
                  {effectivePageMeta.title}
                </h1>
                {effectivePageMeta.description && (
                  <p className="text-muted-foreground truncate text-xs">
                    {effectivePageMeta.description}
                  </p>
                )}
              </div>
            </div>

            {/* Right Section: Actions, search, notifications, mobile nav, brand dropdown */}
            <div className="flex items-center space-x-2">
              {/* Search button */}
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

              {/* Primary action: New Post */}
              <ButtonGroup className="hidden sm:inline-flex">
                <Button
                  size="sm"
                  className="h-9 gap-2 pr-2 pl-3"
                  onClick={() => openSidebar('post-create')}
                  aria-label="Create new post"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  New Post
                </Button>
                <Popover open={createMenuOpen} onOpenChange={setCreateMenuOpen}>
                  <PopoverTrigger asChild>
                    <Button size="icon" className="h-9 w-9" aria-label="Open create actions menu">
                      <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-72 rounded-xl p-0 text-sm">
                    <div className="px-4 py-3">
                      <div className="text-sm font-medium">Create</div>
                      <div className="text-muted-foreground text-xs">
                        {selectedBrand ? `For ${selectedBrand.name}` : 'Choose a brand to begin.'}
                      </div>
                    </div>
                    <Separator />
                    <div className="p-2">
                      <Button
                        type="button"
                        variant="ghost"
                        className="w-full justify-start"
                        disabled={!selectedBrand}
                        onClick={() => {
                          setCreateMenuOpen(false);
                          navigate('/campaigns/create');
                        }}
                      >
                        <Megaphone className="h-4 w-4" aria-hidden="true" />
                        New Campaign
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="w-full justify-start"
                        disabled={!selectedBrand}
                        onClick={() => {
                          if (!selectedBrand) return;
                          setCreateMenuOpen(false);
                          openSidebar('asset-upload', { id: selectedBrand.id });
                        }}
                      >
                        <Upload className="h-4 w-4" aria-hidden="true" />
                        Upload Asset
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </ButtonGroup>
              <Button
                size="icon"
                className="mr-2 h-9 w-9 sm:mr-0 sm:hidden"
                onClick={() => openSidebar('post-create')}
                aria-label="Create new post"
              >
                <Plus className="h-5 w-5" aria-hidden="true" />
              </Button>

              {/* Mobile navigation menu */}
              <div className="relative md:hidden" ref={menuRef}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => setMenuOpen(!menuOpen)}
                  aria-label="More navigation options"
                  aria-expanded={menuOpen}
                  aria-haspopup="true"
                >
                  <Grid3X3 className="h-5 w-5" aria-hidden="true" />
                </Button>

                {menuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-30 bg-black/20 md:hidden"
                      onClick={() => setMenuOpen(false)}
                    />
                    <div className="bg-card absolute right-0 z-40 mt-2 w-80 rounded-lg border shadow-lg">
                      <div className="p-4">
                        <div className="mb-4">
                          <div className="space-y-1">
                            {mainNavItems.map((item) => (
                              <Link
                                key={item.path}
                                to={item.path}
                                onClick={() => setMenuOpen(false)}
                                className={cn(
                                  'flex items-center rounded-lg px-3 py-2 text-sm transition-colors',
                                  isActiveRoute(item)
                                    ? 'bg-accent text-primary'
                                    : 'hover:bg-accent hover:text-accent-foreground'
                                )}
                              >
                                <item.icon className="mr-3 h-5 w-5" aria-hidden="true" />
                                <div>
                                  <div className="font-medium">{item.label}</div>
                                  {item.description && (
                                    <div className="text-muted-foreground text-xs">
                                      {item.description}
                                    </div>
                                  )}
                                </div>
                              </Link>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-1 border-t pt-4">
                          <Link
                            to="/dashboard"
                            onClick={() => setMenuOpen(false)}
                            className="hover:bg-accent flex items-center rounded-lg px-3 py-2 text-sm transition-colors"
                          >
                            <Home className="mr-3 h-4 w-4" aria-hidden="true" />
                            Dashboard
                          </Link>
                          <Link
                            to="/brands"
                            onClick={() => setMenuOpen(false)}
                            className="hover:bg-accent flex items-center rounded-lg px-3 py-2 text-sm transition-colors"
                          >
                            <Building2 className="mr-3 h-4 w-4" aria-hidden="true" />
                            Manage Brands
                          </Link>
                          {secondaryNavItems.map((item) => (
                            <Link
                              key={item.path}
                              to={item.path}
                              onClick={() => setMenuOpen(false)}
                              className="hover:bg-accent flex items-center rounded-lg px-3 py-2 text-sm transition-colors"
                            >
                              <item.icon className="mr-3 h-4 w-4" aria-hidden="true" />
                              {item.label}
                            </Link>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Brand + account dropdown */}
              {user && (
                <div className="md:hidden">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="flex h-9 w-9 shrink-0 items-center justify-center p-0"
                        aria-label="User and brand menu"
                      >
                        <div className="bg-primary flex h-7 w-7 items-center justify-center rounded-full">
                          <span className="text-primary-foreground text-xs font-semibold">
                            {selectedBrand?.name?.charAt(0) || user.email?.charAt(0)?.toUpperCase()}
                          </span>
                        </div>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuLabel>
                        <div className="flex flex-col space-y-1">
                          <p className="text-sm leading-none font-medium">Account</p>
                          <p className="text-muted-foreground text-xs leading-none">{user.email}</p>
                        </div>
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />

                      {/* Brand switching */}
                      {brands.length > 0 && (
                        <>
                          <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                            Switch Brand
                          </DropdownMenuLabel>
                          {brands.map((brand) => (
                            <DropdownMenuItem
                              key={brand.id}
                              onClick={() => setSelectedBrand(brand)}
                              className={
                                selectedBrand?.id === brand.id ? 'bg-accent font-medium' : ''
                              }
                            >
                              <div className="flex w-full items-center justify-between">
                                <span>{brand.name}</span>
                                {selectedBrand?.id === brand.id && <CheckmarkIcon />}
                              </div>
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuSeparator />
                        </>
                      )}

                      <DropdownMenuItem onClick={() => navigate('/brands')}>
                        <Building2 className="mr-2 h-4 w-4" aria-hidden="true" />
                        Manage Brands
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate('/security')}>
                        <Shield className="mr-2 h-4 w-4" aria-hidden="true" />
                        Security
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleLogout} className="text-destructive">
                        <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                        Logout
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Command palette search */}
        <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
          <CommandInput
            placeholder="Search features, campaigns, analytics..."
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>

            <CommandGroup heading="Navigation">
              {filteredItems.map((item) => (
                <CommandItem
                  key={item.path}
                  onSelect={() => handleSearchSelect(item.path)}
                  className="flex items-center space-x-3 px-2 py-2"
                >
                  <item.icon className="h-4 w-4" aria-hidden="true" />
                  <div className="flex flex-col">
                    <span>{item.label}</span>
                    {item.description && (
                      <span className="text-muted-foreground text-xs">{item.description}</span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandGroup heading="Quick Actions">
              <CommandItem
                onSelect={() => {
                  navigate('/posts/create');
                  setSearchOpen(false);
                }}
              >
                <Plus className="mr-3 h-4 w-4" aria-hidden="true" />
                Create New Post
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  navigate('/campaigns/create');
                  setSearchOpen(false);
                }}
              >
                <Sparkles className="mr-3 h-4 w-4" aria-hidden="true" />
                Create New Campaign
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  navigate('/brands');
                  setSearchOpen(false);
                }}
              >
                <Building2 className="mr-3 h-4 w-4" aria-hidden="true" />
                Add New Brand
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  navigate('/settings');
                  setSearchOpen(false);
                }}
              >
                <Settings className="mr-3 h-4 w-4" aria-hidden="true" />
                Account Settings
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </CommandDialog>

        {/* Global help modal and sidebar */}
        <WizardHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
        <RightHelpDrawer open={helpDrawerOpen} onOpenChange={setHelpDrawerOpen} />

        {/* Main content and universal right sidebar */}
        <main
          id="main-content"
          className="min-w-0 flex-1 overflow-y-auto overscroll-y-none px-4 pt-6 pb-24 sm:px-6 lg:px-8"
        >
          <RightSidebarRoot>{children}</RightSidebarRoot>
        </main>

        {/* Footer */}
        <footer
          className={cn('bg-card fixed right-0 bottom-0 left-0 z-30 border-t', 'md:left-[52px]')}
        >
          <div className="px-4 py-2 sm:px-6 lg:px-8">
            <div className="text-muted-foreground flex w-full flex-col items-center justify-center space-y-1 text-xs md:flex-row md:space-y-0 md:text-sm">
              <div className="flex w-full flex-wrap items-center justify-center gap-1 text-xs md:justify-end md:text-sm">
                <Link
                  to="/limits"
                  className="hover:text-foreground hover:bg-accent rounded px-2 py-0.5 transition-colors"
                >
                  Limits & Plans
                </Link>
                <span className="text-muted-foreground/50">•</span>
                <Link
                  to="/privacy-policy"
                  className="hover:text-foreground hover:bg-accent rounded px-2 py-0.5 transition-colors"
                >
                  Privacy Policy
                </Link>
                <span className="text-muted-foreground/50">•</span>
                <Link
                  to="/terms-of-service"
                  className="hover:text-foreground hover:bg-accent rounded px-2 py-0.5 transition-colors"
                >
                  Terms of Service
                </Link>
                <span className="text-muted-foreground/50">•</span>
                <Link
                  to="/legal/data-deletion"
                  className="hover:text-foreground hover:bg-accent rounded px-2 py-0.5 transition-colors"
                >
                  Data Deletion
                </Link>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

function CheckmarkIcon() {
  return <span className="text-primary text-xs font-semibold">✓</span>;
}
