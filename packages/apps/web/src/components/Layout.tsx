import { type ReactNode } from 'react';
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
import { ChevronDown, Settings, LogOut, Check, Building2 } from 'lucide-react';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuthStore();
  const { selectedBrand, brands, setSelectedBrand } = useBrandStore();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isActiveRoute = (path: string) => {
    return location.pathname === path;
  };

  return (
    <div className="bg-background min-h-screen">
      <nav className="bg-card border-b shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 justify-between">
            <div className="flex items-center">
              <Link to="/dashboard" className="flex flex-shrink-0 items-center space-x-2">
                <img src="/postolio-icon.svg" alt="Postolio Logo" className="h-8 w-8" />
                <h1 className="text-foreground text-xl font-bold">Postolio</h1>
              </Link>
              <NavigationMenu className="ml-6">
                <NavigationMenuList>
                  <NavigationMenuItem>
                    <Link
                      to="/campaigns"
                      className={`${navigationMenuTriggerStyle()} ${
                        location.pathname === '/campaigns' ||
                        location.pathname.startsWith('/campaigns/')
                          ? '!bg-accent !text-accent-foreground'
                          : ''
                      }`}
                    >
                      Campaigns
                    </Link>
                  </NavigationMenuItem>
                  <NavigationMenuItem>
                    <Link
                      to="/content"
                      className={`${navigationMenuTriggerStyle()} ${
                        isActiveRoute('/content') ? '!bg-accent !text-accent-foreground' : ''
                      }`}
                    >
                      Content
                    </Link>
                  </NavigationMenuItem>
                  <NavigationMenuItem>
                    <Link
                      to="/analytics"
                      className={`${navigationMenuTriggerStyle()} ${
                        isActiveRoute('/analytics') ? '!bg-accent !text-accent-foreground' : ''
                      }`}
                    >
                      Analytics
                    </Link>
                  </NavigationMenuItem>
                  <NavigationMenuItem>
                    <Link
                      to="/engagement"
                      className={`${navigationMenuTriggerStyle()} ${
                        isActiveRoute('/engagement') ? '!bg-accent !text-accent-foreground' : ''
                      }`}
                    >
                      Engagement
                    </Link>
                  </NavigationMenuItem>
                  <NavigationMenuItem>
                    <Link
                      to="/growth"
                      className={`${navigationMenuTriggerStyle()} ${
                        isActiveRoute('/growth') ? '!bg-accent !text-accent-foreground' : ''
                      }`}
                    >
                      Growth
                    </Link>
                  </NavigationMenuItem>
                  <NavigationMenuItem>
                    <Link
                      to="/ai-features"
                      className={`${navigationMenuTriggerStyle()} ${
                        isActiveRoute('/ai-features') ? '!bg-accent !text-accent-foreground' : ''
                      }`}
                    >
                      AI Features
                    </Link>
                  </NavigationMenuItem>
                </NavigationMenuList>
              </NavigationMenu>
            </div>

            <div className="flex items-center space-x-4">
              {/* User Profile Dropdown */}
              {user && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="flex items-center space-x-2 px-3">
                      <span className="hidden text-sm sm:inline">
                        {selectedBrand ? selectedBrand.name : 'No Brand Selected'}
                      </span>
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-56 border border-gray-200 bg-white shadow-lg"
                  >
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
                                <Check className="h-4 w-4 text-blue-600" />
                              )}
                            </div>
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                      </>
                    )}

                    {/* Brand Management */}
                    <DropdownMenuItem onClick={() => navigate('/brands')}>
                      <Building2 className="mr-2 h-4 w-4" />
                      Manage Brands
                    </DropdownMenuItem>

                    {/* Settings */}
                    <DropdownMenuItem onClick={() => navigate('/settings')}>
                      <Settings className="mr-2 h-4 w-4" />
                      Settings
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />

                    {/* Logout */}
                    <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                      <LogOut className="mr-2 h-4 w-4" />
                      Logout
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl py-6 sm:px-6 lg:px-8">{children}</main>

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
