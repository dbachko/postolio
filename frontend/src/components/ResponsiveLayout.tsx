import { useState, type ReactNode, useEffect, useCallback } from 'react'
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { 
  ChevronDown, 
  Settings, 
  LogOut, 
  Check, 
  Building2, 
  Menu, 
  Search,
  BarChart3,
  Instagram,
  TrendingUp,
  Brain,
  Users,
  Megaphone
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface LayoutProps {
  children: ReactNode
}

interface NavigationItem {
  label: string
  path: string
  icon: typeof Megaphone
  description?: string
}

const navigationItems: NavigationItem[] = [
  {
    label: 'Campaigns',
    path: '/campaigns',
    icon: Megaphone,
    description: 'Manage content campaigns'
  },
  {
    label: 'Analytics',
    path: '/analytics',
    icon: BarChart3,
    description: 'Performance metrics'
  },
  {
    label: 'Instagram',
    path: '/instagram-analytics',
    icon: Instagram,
    description: 'Instagram insights'
  },
  {
    label: 'Engagement',
    path: '/engagement',
    icon: Users,
    description: 'Audience engagement'
  },
  {
    label: 'Growth',
    path: '/growth',
    icon: TrendingUp,
    description: 'Growth strategies'
  },
  {
    label: 'AI Features',
    path: '/ai-features',
    icon: Brain,
    description: 'AI-powered tools'
  }
]

export function ResponsiveLayout({ children }: LayoutProps) {
  const { user, logout } = useAuthStore()
  const { selectedBrand, brands, setSelectedBrand } = useBrandStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const isActiveRoute = (path: string) => {
    if (path === '/campaigns') {
      return location.pathname === path || location.pathname.startsWith('/campaigns/')
    }
    return location.pathname === path
  }

  // Command palette keyboard shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location])

  // Handle search selection
  const handleSearchSelect = useCallback((path: string) => {
    navigate(path)
    setSearchOpen(false)
    setSearchQuery('')
  }, [navigate])

  // Filter navigation items based on search query
  const filteredItems = navigationItems.filter(item => 
    item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.description?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-background">
      {/* Skip to main content for accessibility */}
      <a 
        href="#main-content" 
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 z-50 px-4 py-2 bg-primary text-primary-foreground rounded-md"
      >
        Skip to main content
      </a>

      <nav className="bg-card shadow-sm border-b" role="navigation" aria-label="Main navigation">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            {/* Logo and Desktop Navigation */}
            <div className="flex items-center">
              <Link 
                to="/dashboard" 
                className="flex-shrink-0 flex items-center space-x-2"
                aria-label="Postolio home"
              >
                <img 
                  src="/postolio-icon.svg" 
                  alt="" 
                  className="w-8 h-8"
                  aria-hidden="true"
                />
                <h1 className="text-xl font-bold text-foreground">Postolio</h1>
              </Link>

              {/* Desktop Navigation Menu */}
              <NavigationMenu className="ml-6 hidden md:flex max-w-[600px] lg:max-w-none">
                <NavigationMenuList className="flex-nowrap overflow-x-auto">
                  {navigationItems.map((item) => (
                    <NavigationMenuItem key={item.path}>
                      <Link
                        to={item.path}
                        className={cn(
                          navigationMenuTriggerStyle(),
                          isActiveRoute(item.path) && "!bg-accent !text-accent-foreground"
                        )}
                        aria-current={isActiveRoute(item.path) ? 'page' : undefined}
                      >
                        <item.icon className="w-4 h-4 mr-2 flex-shrink-0" aria-hidden="true" />
                        <span className="hidden lg:inline whitespace-nowrap">{item.label}</span>
                        <span className="lg:hidden" aria-label={item.label}>
                          <item.icon className="w-4 h-4" aria-hidden="true" />
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
                className="relative hidden sm:flex items-center justify-start text-sm text-muted-foreground px-3 py-2 h-9"
                onClick={() => setSearchOpen(true)}
                aria-label="Search (Press ⌘K)"
              >
                <Search className="mr-2 h-4 w-4" aria-hidden="true" />
                <span className="hidden lg:inline">Search...</span>
                <kbd className="pointer-events-none absolute right-1.5 hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
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
                      <span className="hidden sm:inline text-sm">
                        {selectedBrand ? selectedBrand.name : 'No Brand Selected'}
                      </span>
                      <ChevronDown className="w-4 h-4" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
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
                              {selectedBrand?.id === brand.id && (
                                <Check className="w-4 h-4 text-blue-600" aria-hidden="true" />
                              )}
                            </div>
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                      </>
                    )}

                    {/* Brand Management */}
                    <DropdownMenuItem onClick={() => navigate('/brands')}>
                      <Building2 className="w-4 h-4 mr-2" aria-hidden="true" />
                      Manage Brands
                    </DropdownMenuItem>
                    
                    {/* Settings */}
                    <DropdownMenuItem onClick={() => navigate('/settings')}>
                      <Settings className="w-4 h-4 mr-2" aria-hidden="true" />
                      Settings
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />

                    {/* Logout */}
                    <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                      <LogOut className="w-4 h-4 mr-2" aria-hidden="true" />
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
                
                <SheetContent side="right" className="w-80 sm:w-96 flex flex-col h-full overflow-hidden">
                  <SheetHeader className="flex-shrink-0">
                    <SheetTitle>Navigation</SheetTitle>
                  </SheetHeader>
                  
                  {/* Mobile Search - Fixed at top */}
                  <div className="mt-4 mb-4 px-6 flex-shrink-0">
                    <Button
                      variant="outline"
                      className="w-full justify-start"
                      onClick={() => {
                        setMobileMenuOpen(false)
                        setSearchOpen(true)
                      }}
                    >
                      <Search className="mr-2 h-4 w-4" aria-hidden="true" />
                      Search...
                    </Button>
                  </div>

                  {/* Scrollable Navigation Links */}
                  <div className="flex-1 overflow-y-auto px-6">
                    <nav 
                      aria-label="Mobile navigation"
                      id="mobile-navigation"
                    >
                      <ul className="space-y-1 pb-4" role="list">
                        {navigationItems.map((item) => (
                          <li key={item.path}>
                            <Link
                              to={item.path}
                              onClick={() => setMobileMenuOpen(false)}
                              className={cn(
                                "flex items-center space-x-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors",
                                "hover:bg-accent hover:text-accent-foreground",
                                "focus:bg-accent focus:text-accent-foreground focus:outline-none",
                                isActiveRoute(item.path) && "bg-accent text-accent-foreground"
                              )}
                              aria-current={isActiveRoute(item.path) ? 'page' : undefined}
                            >
                              <item.icon className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
                              <div className="flex flex-col">
                                <span>{item.label}</span>
                                {item.description && (
                                  <span className="text-xs text-muted-foreground mt-0.5">
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
                    <div className="border-t pt-4 px-6 pb-6 flex-shrink-0 space-y-3">
                      <div>
                        <p className="text-sm font-medium">{user.email}</p>
                        {selectedBrand && (
                          <p className="text-xs text-muted-foreground">
                            Brand: {selectedBrand.name}
                          </p>
                        )}
                      </div>
                      
                      <div className="space-y-1">
                        <Link
                          to="/brands"
                          onClick={() => setMobileMenuOpen(false)}
                          className="flex items-center space-x-3 px-4 py-2 text-sm rounded-lg hover:bg-accent"
                        >
                          <Building2 className="w-4 h-4" aria-hidden="true" />
                          <span>Manage Brands</span>
                        </Link>
                        
                        <Link
                          to="/settings"
                          onClick={() => setMobileMenuOpen(false)}
                          className="flex items-center space-x-3 px-4 py-2 text-sm rounded-lg hover:bg-accent"
                        >
                          <Settings className="w-4 h-4" aria-hidden="true" />
                          <span>Settings</span>
                        </Link>
                        
                        <button
                          onClick={() => {
                            setMobileMenuOpen(false)
                            handleLogout()
                          }}
                          className="flex items-center space-x-3 px-4 py-2 text-sm rounded-lg hover:bg-accent text-red-600 w-full text-left"
                        >
                          <LogOut className="w-4 h-4" aria-hidden="true" />
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
                  navigate('/campaigns')
                  setSearchOpen(false)
                }}
              >
                <Megaphone className="w-4 h-4 mr-3" aria-hidden="true" />
                Create New Campaign
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  navigate('/brands')
                  setSearchOpen(false)
                }}
              >
                <Building2 className="w-4 h-4 mr-3" aria-hidden="true" />
                Add New Brand
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  navigate('/settings')
                  setSearchOpen(false)
                }}
              >
                <Settings className="w-4 h-4 mr-3" aria-hidden="true" />
                Account Settings
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>

      {/* Main Content */}
      <main id="main-content" className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
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
  )
}