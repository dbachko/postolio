import { useState, type ReactNode, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useBrandStore } from '../stores/brandStore';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { EmailVerificationBanner } from './EmailVerificationBanner';
import { Button } from '@/components/ui/button';
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
  Settings,
  LogOut,
  Check,
  Building2,
  Search,
  // BarChart3,
  Megaphone,
  Grid3X3,
  FileText,
  FileEdit,
  Sparkles,
  Home,
  Shield,
  Plus,
  Sun,
  Moon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { WizardHelpDialog } from './campaign-wizard/shared/WizardHelpDialog';
import { RightHelpDrawer } from './help/RightHelpDrawer';
import { ScheduleLimitBanner } from './ScheduleLimitBanner';
import { useTheme } from '@/contexts/ThemeContext';

interface LayoutProps {
  children: ReactNode;
}

interface NavigationItem {
  label: string;
  path: string;
  icon: typeof Megaphone;
  description?: string;
  matchType?: 'exact' | 'startsWith';
}

// Main navigation items (always visible on desktop)
const mainNavItems: NavigationItem[] = [
  {
    label: 'Campaigns',
    path: '/campaigns',
    icon: Megaphone,
    description: 'Manage content campaigns',
    matchType: 'startsWith',
  },
  {
    label: 'Content',
    path: '/content',
    icon: FileText,
    description: 'Content library',
    matchType: 'exact',
  },
  {
    label: 'Drafts',
    path: '/drafts',
    icon: FileEdit,
    description: 'Work-in-progress posts',
    matchType: 'exact',
  },
  // {
  //   label: 'Analytics',
  //   path: '/analytics',
  //   icon: BarChart3,
  //   description: 'Performance metrics',
  //   matchType: 'exact',
  // },
];

// Secondary navigation items (in dropdown menu)
const secondaryNavItems: NavigationItem[] = [];

// Combine all navigation items for search
const allNavItems = [...mainNavItems, ...secondaryNavItems];

// Utility function for route matching
const isRouteActive = (item: NavigationItem, currentPath: string): boolean => {
  if (item.matchType === 'startsWith') {
    return currentPath === item.path || currentPath.startsWith(item.path + '/');
  }
  // Default to exact match
  return currentPath === item.path;
};

export function AppLayout({ children }: LayoutProps) {
  const containerCls = 'mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8';
  const { user, logout } = useAuthStore();
  const { selectedBrand, brands, setSelectedBrand } = useBrandStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpDrawerOpen, setHelpDrawerOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { theme, toggleTheme } = useTheme();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isActiveRoute = useCallback(
    (item: NavigationItem) => {
      return isRouteActive(item, location.pathname);
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

  // Close menu when clicking outside
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

  return (
    <div className="bg-background flex min-h-screen flex-col">
      {/* Skip to main content for accessibility */}
      <a
        href="#main-content"
        className="bg-primary text-primary-foreground sr-only z-50 rounded-md px-4 py-2 focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to main content
      </a>

      {/* Capacity banner above top nav */}
      <ScheduleLimitBanner />

      {/* Ultra-thin navigation bar */}
      <nav
        className="bg-card sticky top-0 z-40 h-14 border-b shadow-sm"
        role="navigation"
        aria-label="Main navigation"
      >
        <div className={cn('h-full', containerCls)}>
          <div className="flex h-full items-center justify-between">
            {/* Left Section: Logo + Main Nav (Desktop) / Logo (Mobile) */}
            <div className="flex h-full items-center">
              {/* Logo */}
              <Link
                to="/dashboard"
                className="mr-8 flex items-center space-x-2"
                aria-label="Postolio home"
              >
                <img src="/postolio-icon.svg" alt="" className="h-7 w-7" aria-hidden="true" />
                <h1 className="text-foreground hidden text-lg font-bold sm:block">Postolio</h1>
              </Link>

              {/* Main Navigation Items - Desktop Only */}
              <div className="hidden h-full items-center md:flex">
                {mainNavItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                      'flex h-full items-center border-b-2 px-6 transition-colors',
                      isActiveRoute(item)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/50 border-transparent'
                    )}
                    aria-current={isActiveRoute(item) ? 'page' : undefined}
                  >
                    <item.icon className="mr-2 h-5 w-5" aria-hidden="true" />
                    <span className="text-sm font-medium">{item.label}</span>
                  </Link>
                ))}
              </div>
            </div>

            {/* Right Section: Search + Menu + Brand Dropdown */}
            <div className="flex items-center space-x-2">
              {/* Primary action: New Post (permanent in top bar) */}
              <Button
                size="sm"
                className="hidden gap-2 sm:inline-flex"
                onClick={() => navigate('/posts/create')}
                aria-label="Create new post"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                New Post
              </Button>
              <Button
                size="icon"
                className="sm:hidden"
                onClick={() => navigate('/posts/create')}
                aria-label="Create new post"
              >
                <Plus className="h-5 w-5" aria-hidden="true" />
              </Button>

              {/* Theme toggle */}
              <Button
                variant="ghost"
                size="icon"
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                onClick={toggleTheme}
                className="h-9 w-9"
                title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
              >
                {theme === 'dark' ? (
                  <Sun className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Moon className="h-4 w-4" aria-hidden="true" />
                )}
              </Button>
              {/* Search Button */}
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hidden h-9 items-center sm:flex"
                onClick={() => setSearchOpen(true)}
                aria-label="Search (Press ⌘K)"
              >
                <Search className="h-4 w-4" aria-hidden="true" />
                <span className="ml-2 hidden text-sm lg:inline">Search</span>
                <kbd className="bg-muted pointer-events-none ml-2 hidden h-5 select-none items-center gap-1 rounded border px-1.5 font-mono text-[10px] font-medium opacity-100 lg:inline-flex">
                  <span className="text-xs">⌘</span>K
                </kbd>
              </Button>

              {/* Grid Menu Dropdown (hidden on desktop when main nav is visible) */}
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

                {/* Dropdown Menu */}
                {menuOpen && (
                  <>
                    {/* Backdrop for mobile */}
                    <div
                      className="fixed inset-0 z-30 bg-black/20 md:hidden"
                      onClick={() => setMenuOpen(false)}
                    />

                    {/* Menu Content */}
                    <div className="bg-card absolute right-0 z-40 mt-2 w-80 rounded-lg border shadow-lg">
                      <div className="p-4">
                        {/* Mobile: Show main nav items */}
                        <div className="mb-4 md:hidden">
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
                                  <div className="text-muted-foreground text-xs">
                                    {item.description}
                                  </div>
                                </div>
                              </Link>
                            ))}
                          </div>
                        </div>

                        {/* Secondary Navigation Items */}
                        <div className="grid grid-cols-2 gap-2">
                          {secondaryNavItems.map((item) => (
                            <Link
                              key={item.path}
                              to={item.path}
                              onClick={() => setMenuOpen(false)}
                              className={cn(
                                'flex flex-col items-center rounded-lg p-3 text-center transition-colors',
                                isActiveRoute(item)
                                  ? 'bg-accent text-primary'
                                  : 'hover:bg-accent hover:text-accent-foreground'
                              )}
                            >
                              <item.icon className="mb-2 h-6 w-6" aria-hidden="true" />
                              <span className="text-xs font-medium">{item.label}</span>
                            </Link>
                          ))}
                        </div>

                        {/* Quick Actions */}
                        <div className="mt-4 space-y-1 border-t pt-4">
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
                          <Link
                            to="/settings"
                            onClick={() => setMenuOpen(false)}
                            className="hover:bg-accent flex items-center rounded-lg px-3 py-2 text-sm transition-colors"
                          >
                            <Settings className="mr-3 h-4 w-4" aria-hidden="true" />
                            Settings
                          </Link>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Brand Dropdown */}
              {user && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className="flex h-9 items-center px-2"
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
                        <p className="text-sm font-medium leading-none">Account</p>
                        <p className="text-muted-foreground text-xs leading-none">{user.email}</p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />

                    {/* Brand Switching Section */}
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
                              {selectedBrand?.id === brand.id && (
                                <Check className="text-primary h-4 w-4" aria-hidden="true" />
                              )}
                            </div>
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                      </>
                    )}

                    {/* User Actions */}
                    <DropdownMenuItem onClick={() => navigate('/brands')}>
                      <Building2 className="mr-2 h-4 w-4" aria-hidden="true" />
                      Manage Brands
                    </DropdownMenuItem>

                    <DropdownMenuItem onClick={() => navigate('/settings')}>
                      <Settings className="mr-2 h-4 w-4" aria-hidden="true" />
                      Settings
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
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Command Palette Search */}
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

      {/* Global Help Modal and Sidebar (scaffolded) */}
      <WizardHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <RightHelpDrawer open={helpDrawerOpen} onOpenChange={setHelpDrawerOpen} />

      {/* Email Verification Banner */}
      <EmailVerificationBanner />

      {/* Main Content */}
      <main id="main-content" className={cn('flex-1 py-6', containerCls)}>
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-card mt-8 border-t">
        <div className={cn('py-4', containerCls)}>
          <div className="text-muted-foreground flex flex-col items-center justify-between space-y-3 text-sm md:flex-row md:space-y-0">
            <div className="text-center md:text-left">
              © {new Date().getFullYear()} Postolio. All rights reserved.
            </div>
            <div className="flex items-center gap-1 text-xs md:text-sm">
              <Link
                to="/limits"
                className="hover:text-foreground hover:bg-accent rounded px-2 py-1 transition-colors"
              >
                Limits & Plans
              </Link>
              <span className="text-muted-foreground/50">•</span>
              <Link
                to="/privacy-policy"
                className="hover:text-foreground hover:bg-accent rounded px-2 py-1 transition-colors"
              >
                Privacy Policy
              </Link>
              <span className="text-muted-foreground/50">•</span>
              <Link
                to="/terms-of-service"
                className="hover:text-foreground hover:bg-accent rounded px-2 py-1 transition-colors"
              >
                Terms of Service
              </Link>
              <span className="text-muted-foreground/50">•</span>
              <Link
                to="/legal/data-deletion"
                className="hover:text-foreground hover:bg-accent rounded px-2 py-1 transition-colors"
              >
                Data Deletion
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
