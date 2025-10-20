import { useState, type ReactNode, useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useBrandStore } from '../stores/brandStore';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from '@/components/ui/navigation-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  ChevronDown,
  Settings,
  LogOut,
  Check,
  Building2,
  Menu,
  Search,
  BarChart3,
  TrendingUp,
  Brain,
  Users,
  Megaphone,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface LayoutProps {
  children: ReactNode;
}

interface NavigationItem {
  label: string;
  path: string;
  icon: typeof Megaphone;
  description?: string;
}

const navigationItems: NavigationItem[] = [
  {
    label: 'Campaigns',
    path: '/campaigns',
    icon: Megaphone,
    description: 'Manage content campaigns',
  },
  {
    label: 'Analytics',
    path: '/analytics',
    icon: BarChart3,
    description: 'Performance metrics',
  },
  {
    label: 'Engagement',
    path: '/engagement',
    icon: Users,
    description: 'Audience engagement',
  },
  {
    label: 'Growth',
    path: '/growth',
    icon: TrendingUp,
    description: 'Growth strategies',
  },
  {
    label: 'AI Features',
    path: '/ai-features',
    icon: Brain,
    description: 'AI-powered tools',
  },
];

export function ResponsiveLayout({ children }: LayoutProps) {
  const { user, logout } = useAuthStore();
  const { selectedBrand, brands, setSelectedBrand } = useBrandStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isActiveRoute = (path: string) => {
    if (path === '/campaigns') {
      return location.pathname === path || location.pathname.startsWith('/campaigns/');
    }
    return location.pathname === path;
  };

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

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
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
  const filteredItems = navigationItems.filter(
    (item) =>
      item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="bg-background min-h-screen">
      {/* Skip to main content for accessibility */}
      <a
        href="#main-content"
        className="bg-primary text-primary-foreground sr-only z-50 rounded-md px-4 py-2 focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to main content
      </a>

      <nav className="bg-card border-b shadow-sm" role="navigation" aria-label="Main navigation">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 justify-between">
            {/* Logo and Desktop Navigation */}
            <div className="flex items-center">
              <Link
                to="/dashboard"
                className="flex flex-shrink-0 items-center space-x-2"
                aria-label="Postolio home"
              >
                <img src="/postolio-icon.svg" alt="" className="h-8 w-8" aria-hidden="true" />
                <h1 className="text-foreground text-xl font-bold">Postolio</h1>
              </Link>

              {/* Desktop Navigation Menu */}
              <NavigationMenu className="ml-6 hidden max-w-[600px] md:flex lg:max-w-none">
                <NavigationMenuList className="flex-nowrap overflow-x-auto">
                  {navigationItems.map((item) => (
                    <NavigationMenuItem key={item.path}>
                      <Link
                        to={item.path}
                        className={cn(
                          navigationMenuTriggerStyle(),
                          isActiveRoute(item.path) && '!bg-accent !text-accent-foreground'
                        )}
                        aria-current={isActiveRoute(item.path) ? 'page' : undefined}
                      >
                        <item.icon className="mr-2 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                        <span className="hidden whitespace-nowrap lg:inline">{item.label}</span>
                        <span className="lg:hidden" aria-label={item.label}>
                          <item.icon className="h-4 w-4" aria-hidden="true" />
                        </span>
                      </Link>
                    </NavigationMenuItem>
                  ))}
                </NavigationMenuList>
              </NavigationMenu>
            </div>

            {/* Right Side Actions */}
            <div className="flex items-center space-x-2">
              {/* Search Button */}
              <Button
                variant="outline"
                className="text-muted-foreground relative hidden h-9 items-center justify-start px-3 py-2 text-sm sm:flex"
                onClick={() => setSearchOpen(true)}
                aria-label="Search (Press ⌘K)"
              >
                <Search className="mr-2 h-4 w-4" aria-hidden="true" />
                <span className="hidden lg:inline">Search...</span>
                <kbd className="bg-muted pointer-events-none absolute right-1.5 hidden h-5 select-none items-center gap-1 rounded border px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
                  <span className="text-xs">⌘</span>K
                </kbd>
              </Button>

              {/* User Profile Dropdown */}
              {user && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className="flex items-center space-x-2 px-3"
                      aria-label="User menu"
                      aria-expanded="false"
                      aria-haspopup="true"
                    >
                      <span className="hidden text-sm sm:inline">
                        {selectedBrand ? selectedBrand.name : 'No Brand Selected'}
                      </span>
                      <ChevronDown className="h-4 w-4" aria-hidden="true" />
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
                                <Check className="h-4 w-4 text-blue-600" aria-hidden="true" />
                              )}
                            </div>
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                      </>
                    )}

                    {/* Brand Management */}
                    <DropdownMenuItem onClick={() => navigate('/brands')}>
                      <Building2 className="mr-2 h-4 w-4" aria-hidden="true" />
                      Manage Brands
                    </DropdownMenuItem>

                    {/* Settings */}
                    <DropdownMenuItem onClick={() => navigate('/settings')}>
                      <Settings className="mr-2 h-4 w-4" aria-hidden="true" />
                      Settings
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />

                    {/* Logout */}
                    <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                      <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                      Logout
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {/* Mobile Menu Trigger */}
              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden"
                    aria-label="Open navigation menu"
                    aria-expanded={mobileMenuOpen}
                    aria-controls="mobile-navigation"
                  >
                    <Menu className="h-5 w-5" aria-hidden="true" />
                  </Button>
                </SheetTrigger>

                <SheetContent
                  side="right"
                  className="flex h-full w-80 flex-col overflow-hidden sm:w-96"
                >
                  <SheetHeader className="flex-shrink-0">
                    <SheetTitle>Navigation</SheetTitle>
                  </SheetHeader>

                  {/* Mobile Search - Fixed at top */}
                  <div className="mb-4 mt-4 flex-shrink-0 px-6">
                    <Button
                      variant="outline"
                      className="w-full justify-start"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        setSearchOpen(true);
                      }}
                    >
                      <Search className="mr-2 h-4 w-4" aria-hidden="true" />
                      Search...
                    </Button>
                  </div>

                  {/* Scrollable Navigation Links */}
                  <div className="flex-1 overflow-y-auto px-6">
                    <nav aria-label="Mobile navigation" id="mobile-navigation">
                      <ul className="space-y-1 pb-4" role="list">
                        {navigationItems.map((item) => (
                          <li key={item.path}>
                            <Link
                              to={item.path}
                              onClick={() => setMobileMenuOpen(false)}
                              className={cn(
                                'flex items-center space-x-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors',
                                'hover:bg-accent hover:text-accent-foreground',
                                'focus:bg-accent focus:text-accent-foreground focus:outline-none',
                                isActiveRoute(item.path) && 'bg-accent text-accent-foreground'
                              )}
                              aria-current={isActiveRoute(item.path) ? 'page' : undefined}
                            >
                              <item.icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
                              <div className="flex flex-col">
                                <span>{item.label}</span>
                                {item.description && (
                                  <span className="text-muted-foreground mt-0.5 text-xs">
                                    {item.description}
                                  </span>
                                )}
                              </div>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </nav>
                  </div>

                  {/* Mobile Menu Footer with User Info - Fixed at bottom */}
                  {user && (
                    <div className="flex-shrink-0 space-y-3 border-t px-6 pb-6 pt-4">
                      <div>
                        <p className="text-sm font-medium">{user.email}</p>
                        {selectedBrand && (
                          <p className="text-muted-foreground text-xs">
                            Brand: {selectedBrand.name}
                          </p>
                        )}
                      </div>

                      <div className="space-y-1">
                        <Link
                          to="/brands"
                          onClick={() => setMobileMenuOpen(false)}
                          className="hover:bg-accent flex items-center space-x-3 rounded-lg px-4 py-2 text-sm"
                        >
                          <Building2 className="h-4 w-4" aria-hidden="true" />
                          <span>Manage Brands</span>
                        </Link>

                        <Link
                          to="/settings"
                          onClick={() => setMobileMenuOpen(false)}
                          className="hover:bg-accent flex items-center space-x-3 rounded-lg px-4 py-2 text-sm"
                        >
                          <Settings className="h-4 w-4" aria-hidden="true" />
                          <span>Settings</span>
                        </Link>

                        <button
                          onClick={() => {
                            setMobileMenuOpen(false);
                            handleLogout();
                          }}
                          className="hover:bg-accent flex w-full items-center space-x-3 rounded-lg px-4 py-2 text-left text-sm text-red-600"
                        >
                          <LogOut className="h-4 w-4" aria-hidden="true" />
                          <span>Logout</span>
                        </button>
                      </div>
                    </div>
                  )}
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </nav>

      {/* Command Palette Search */}
      <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
        <Command className="rounded-lg border shadow-md">
          <CommandInput
            placeholder="Search campaigns, analytics, settings..."
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
                  navigate('/campaigns/create?fresh=1');
                  setSearchOpen(false);
                }}
              >
                <Megaphone className="mr-3 h-4 w-4" aria-hidden="true" />
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
        </Command>
      </CommandDialog>

      {/* Main Content */}
      <main id="main-content" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-card mt-8 border-t">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="text-muted-foreground flex flex-col items-center justify-between space-y-3 text-sm md:flex-row md:space-y-0">
            <div className="text-center md:text-left">
              © {new Date().getFullYear()} Postolio. All rights reserved.
            </div>
            <div className="flex items-center gap-1 text-xs md:text-sm">
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
