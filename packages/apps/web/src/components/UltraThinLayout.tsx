import {
  useState,
  type ReactNode,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { useAuthStore } from "../stores/authStore";
import { useBrandStore } from "../stores/brandStore";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { EmailVerificationBanner } from "./EmailVerificationBanner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  ChevronDown,
  Settings,
  LogOut,
  Check,
  Building2,
  Search,
  BarChart3,
  Instagram,
  TrendingUp,
  Brain,
  Users,
  Megaphone,
  Grid3X3,
  FileText,
  Sparkles,
  Home,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: ReactNode;
}

interface NavigationItem {
  label: string;
  path: string;
  icon: typeof Megaphone;
  description?: string;
  matchType?: "exact" | "startsWith";
}

// Main navigation items (always visible on desktop)
const mainNavItems: NavigationItem[] = [
  {
    label: "Campaigns",
    path: "/campaigns",
    icon: Megaphone,
    description: "Manage content campaigns",
    matchType: "startsWith",
  },
  {
    label: "Content",
    path: "/content",
    icon: FileText,
    description: "Content library",
    matchType: "exact",
  },
  {
    label: "Analytics",
    path: "/analytics",
    icon: BarChart3,
    description: "Performance metrics",
    matchType: "exact",
  },
];

// Secondary navigation items (in dropdown menu)
const secondaryNavItems: NavigationItem[] = [
  {
    label: "Instagram",
    path: "/instagram-analytics",
    icon: Instagram,
    description: "Instagram insights",
  },
  {
    label: "Engagement",
    path: "/engagement",
    icon: Users,
    description: "Audience engagement",
  },
  {
    label: "Growth",
    path: "/growth",
    icon: TrendingUp,
    description: "Growth strategies",
  },
  {
    label: "AI Features",
    path: "/ai-features",
    icon: Brain,
    description: "AI-powered tools",
  },
];

// Combine all navigation items for search
const allNavItems = [...mainNavItems, ...secondaryNavItems];

// Utility function for route matching
const isRouteActive = (item: NavigationItem, currentPath: string): boolean => {
  if (item.matchType === "startsWith") {
    return currentPath === item.path || currentPath.startsWith(item.path + "/");
  }
  // Default to exact match
  return currentPath === item.path;
};

export function UltraThinLayout({ children }: LayoutProps) {
  const { user, logout } = useAuthStore();
  const { selectedBrand, brands, setSelectedBrand } = useBrandStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const isActiveRoute = useCallback(
    (item: NavigationItem) => {
      return isRouteActive(item, location.pathname);
    },
    [location.pathname],
  );

  // Command palette keyboard shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
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
      setSearchQuery("");
    },
    [navigate],
  );

  // Filter navigation items based on search query
  const filteredItems = useMemo(
    () =>
      allNavItems.filter(
        (item) =>
          item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.description?.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
    [searchQuery],
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Skip to main content for accessibility */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 z-50 px-4 py-2 bg-primary text-primary-foreground rounded-md"
      >
        Skip to main content
      </a>

      {/* Ultra-thin navigation bar */}
      <nav
        className="bg-card border-b shadow-sm sticky top-0 z-40 h-14"
        role="navigation"
        aria-label="Main navigation"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full">
          <div className="flex items-center justify-between h-full">
            {/* Left Section: Logo + Main Nav (Desktop) / Logo (Mobile) */}
            <div className="flex items-center h-full">
              {/* Logo */}
              <Link
                to="/dashboard"
                className="flex items-center space-x-2 mr-8"
                aria-label="Postolio home"
              >
                <img
                  src="/postolio-icon.svg"
                  alt=""
                  className="w-7 h-7"
                  aria-hidden="true"
                />
                <h1 className="text-lg font-bold text-foreground hidden sm:block">
                  Postolio
                </h1>
              </Link>

              {/* Main Navigation Items - Desktop Only */}
              <div className="hidden md:flex items-center h-full">
                {mainNavItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                      "flex items-center px-6 h-full border-b-2 transition-colors",
                      isActiveRoute(item)
                        ? "border-blue-600 text-blue-600 bg-blue-50/50"
                        : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50",
                    )}
                    aria-current={isActiveRoute(item) ? "page" : undefined}
                  >
                    <item.icon className="w-5 h-5 mr-2" aria-hidden="true" />
                    <span className="font-medium text-sm">{item.label}</span>
                  </Link>
                ))}
              </div>
            </div>

            {/* Right Section: Search + Menu + Brand Dropdown */}
            <div className="flex items-center space-x-2">
              {/* Search Button */}
              <Button
                variant="ghost"
                size="sm"
                className="hidden sm:flex items-center text-muted-foreground h-9"
                onClick={() => setSearchOpen(true)}
                aria-label="Search (Press ⌘K)"
              >
                <Search className="h-4 w-4" aria-hidden="true" />
                <span className="ml-2 hidden lg:inline text-sm">Search</span>
                <kbd className="ml-2 pointer-events-none hidden lg:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100">
                  <span className="text-xs">⌘</span>K
                </kbd>
              </Button>

              {/* Grid Menu Dropdown */}
              <div className="relative" ref={menuRef}>
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
                      className="fixed inset-0 bg-black/20 z-30 md:hidden"
                      onClick={() => setMenuOpen(false)}
                    />

                    {/* Menu Content */}
                    <div className="absolute right-0 mt-2 w-80 bg-card rounded-lg shadow-lg border z-40">
                      <div className="p-4">
                        <h3 className="text-sm font-semibold text-muted-foreground mb-3">
                          More Features
                        </h3>

                        {/* Mobile: Show main nav items */}
                        <div className="md:hidden mb-4">
                          <div className="space-y-1">
                            {mainNavItems.map((item) => (
                              <Link
                                key={item.path}
                                to={item.path}
                                onClick={() => setMenuOpen(false)}
                                className={cn(
                                  "flex items-center px-3 py-2 rounded-lg text-sm transition-colors",
                                  isActiveRoute(item)
                                    ? "bg-blue-50 text-blue-600"
                                    : "hover:bg-accent hover:text-accent-foreground",
                                )}
                              >
                                <item.icon
                                  className="w-5 h-5 mr-3"
                                  aria-hidden="true"
                                />
                                <div>
                                  <div className="font-medium">
                                    {item.label}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {item.description}
                                  </div>
                                </div>
                              </Link>
                            ))}
                          </div>
                          <div className="my-3 border-t" />
                        </div>

                        {/* Secondary Navigation Items */}
                        <div className="grid grid-cols-2 gap-2">
                          {secondaryNavItems.map((item) => (
                            <Link
                              key={item.path}
                              to={item.path}
                              onClick={() => setMenuOpen(false)}
                              className={cn(
                                "flex flex-col items-center p-3 rounded-lg text-center transition-colors",
                                isActiveRoute(item)
                                  ? "bg-blue-50 text-blue-600"
                                  : "hover:bg-accent hover:text-accent-foreground",
                              )}
                            >
                              <item.icon
                                className="w-6 h-6 mb-2"
                                aria-hidden="true"
                              />
                              <span className="text-xs font-medium">
                                {item.label}
                              </span>
                            </Link>
                          ))}
                        </div>

                        {/* Quick Actions */}
                        <div className="mt-4 pt-4 border-t space-y-1">
                          <Link
                            to="/dashboard"
                            onClick={() => setMenuOpen(false)}
                            className="flex items-center px-3 py-2 rounded-lg text-sm hover:bg-accent transition-colors"
                          >
                            <Home className="w-4 h-4 mr-3" aria-hidden="true" />
                            Dashboard
                          </Link>
                          <Link
                            to="/brands"
                            onClick={() => setMenuOpen(false)}
                            className="flex items-center px-3 py-2 rounded-lg text-sm hover:bg-accent transition-colors"
                          >
                            <Building2
                              className="w-4 h-4 mr-3"
                              aria-hidden="true"
                            />
                            Manage Brands
                          </Link>
                          <Link
                            to="/settings"
                            onClick={() => setMenuOpen(false)}
                            className="flex items-center px-3 py-2 rounded-lg text-sm hover:bg-accent transition-colors"
                          >
                            <Settings
                              className="w-4 h-4 mr-3"
                              aria-hidden="true"
                            />
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
                      className="flex items-center space-x-2 h-9 px-3"
                      aria-label="User and brand menu"
                    >
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                        <span className="text-xs font-semibold text-white">
                          {selectedBrand?.name?.charAt(0) ||
                            user.email?.charAt(0)?.toUpperCase()}
                        </span>
                      </div>
                      <span className="hidden sm:inline text-sm font-medium">
                        {selectedBrand ? selectedBrand.name : "Select Brand"}
                      </span>
                      <ChevronDown className="w-3 h-3" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium leading-none">
                          Account
                        </p>
                        <p className="text-xs leading-none text-muted-foreground">
                          {user.email}
                        </p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />

                    {/* Brand Switching Section */}
                    {brands.length > 0 && (
                      <>
                        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                          Switch Brand
                        </DropdownMenuLabel>
                        {brands.map((brand) => (
                          <DropdownMenuItem
                            key={brand.id}
                            onClick={() => setSelectedBrand(brand)}
                            className={
                              selectedBrand?.id === brand.id
                                ? "bg-accent font-medium"
                                : ""
                            }
                          >
                            <div className="flex items-center justify-between w-full">
                              <span>{brand.name}</span>
                              {selectedBrand?.id === brand.id && (
                                <Check
                                  className="w-4 h-4 text-blue-600"
                                  aria-hidden="true"
                                />
                              )}
                            </div>
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                      </>
                    )}

                    {/* User Actions */}
                    <DropdownMenuItem onClick={() => navigate("/brands")}>
                      <Building2 className="w-4 h-4 mr-2" aria-hidden="true" />
                      Manage Brands
                    </DropdownMenuItem>

                    <DropdownMenuItem onClick={() => navigate("/settings")}>
                      <Settings className="w-4 h-4 mr-2" aria-hidden="true" />
                      Settings
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />

                    <DropdownMenuItem
                      onClick={handleLogout}
                      className="text-red-600"
                    >
                      <LogOut className="w-4 h-4 mr-2" aria-hidden="true" />
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
                <item.icon className="w-4 h-4" aria-hidden="true" />
                <div className="flex flex-col">
                  <span>{item.label}</span>
                  {item.description && (
                    <span className="text-xs text-muted-foreground">
                      {item.description}
                    </span>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandGroup heading="Quick Actions">
            <CommandItem
              onSelect={() => {
                navigate("/campaigns");
                setSearchOpen(false);
              }}
            >
              <Sparkles className="w-4 h-4 mr-3" aria-hidden="true" />
              Create New Campaign
            </CommandItem>
            <CommandItem
              onSelect={() => {
                navigate("/brands");
                setSearchOpen(false);
              }}
            >
              <Building2 className="w-4 h-4 mr-3" aria-hidden="true" />
              Add New Brand
            </CommandItem>
            <CommandItem
              onSelect={() => {
                navigate("/settings");
                setSearchOpen(false);
              }}
            >
              <Settings className="w-4 h-4 mr-3" aria-hidden="true" />
              Account Settings
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      {/* Email Verification Banner */}
      <EmailVerificationBanner />

      {/* Main Content */}
      <main
        id="main-content"
        className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8"
      >
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-card border-t mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col md:flex-row justify-between items-center text-sm text-muted-foreground space-y-3 md:space-y-0">
            <div className="text-center md:text-left">
              © {new Date().getFullYear()} Postolio. All rights reserved.
            </div>
            <div className="flex items-center gap-1 text-xs md:text-sm">
              <Link
                to="/privacy-policy"
                className="hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-accent"
              >
                Privacy Policy
              </Link>
              <span className="text-muted-foreground/50">•</span>
              <Link
                to="/terms-of-service"
                className="hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-accent"
              >
                Terms of Service
              </Link>
              <span className="text-muted-foreground/50">•</span>
              <Link
                to="/legal/data-deletion"
                className="hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-accent"
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
