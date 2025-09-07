import { type ReactNode } from 'react'
import { useAuthStore } from '../stores/authStore'
import { useBrandStore } from '../stores/brandStore'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from '@/components/ui/navigation-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown, Settings, LogOut, Check, Building2 } from 'lucide-react'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuthStore()
  const { selectedBrand, brands, setSelectedBrand } = useBrandStore()
  const navigate = useNavigate()
  const location = useLocation()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const isActiveRoute = (path: string) => {
    return location.pathname === path
  }


  return (
    <div className="min-h-screen bg-background">
      <nav className="bg-card shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link to="/dashboard" className="flex-shrink-0 flex items-center space-x-2">
                <img 
                  src="/postolio-icon.svg" 
                  alt="Postolio Logo" 
                  className="w-8 h-8"
                />
                <h1 className="text-xl font-bold text-foreground">Postolio</h1>
              </Link>
              <NavigationMenu className="ml-6">
                <NavigationMenuList>
                  <NavigationMenuItem>
                    <Link
                      to="/campaigns"
                      className={`${navigationMenuTriggerStyle()} ${
                        location.pathname === '/campaigns' || 
                        location.pathname.startsWith('/campaigns/') ? '!bg-accent !text-accent-foreground' : ''
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
                      to="/instagram-analytics"
                      className={`${navigationMenuTriggerStyle()} ${
                        isActiveRoute('/instagram-analytics') ? '!bg-accent !text-accent-foreground' : ''
                      }`}
                    >
                      Instagram Analytics
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
                      <span className="hidden sm:inline text-sm">
                        {selectedBrand ? selectedBrand.name : 'No Brand Selected'}
                      </span>
                      <ChevronDown className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 bg-white border border-gray-200 shadow-lg">
                    <DropdownMenuLabel>
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium leading-none">Account</p>
                        <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
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
                            className={selectedBrand?.id === brand.id ? 'bg-accent font-medium' : ''}
                          >
                            <div className="flex items-center justify-between w-full">
                              <span>{brand.name}</span>
                              {selectedBrand?.id === brand.id && <Check className="w-4 h-4 text-blue-600" />}
                            </div>
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                      </>
                    )}

                    {/* Brand Management */}
                    <DropdownMenuItem onClick={() => navigate('/brands')}>
                      <Building2 className="w-4 h-4 mr-2" />
                      Manage Brands
                    </DropdownMenuItem>
                    
                    {/* Settings */}
                    <DropdownMenuItem onClick={() => navigate('/settings')}>
                      <Settings className="w-4 h-4 mr-2" />
                      Settings
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />

                    {/* Logout */}
                    <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                      <LogOut className="w-4 h-4 mr-2" />
                      Logout
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">{children}</main>
      
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
  )
}
