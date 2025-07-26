import { type ReactNode } from 'react'
import { useAuthStore } from '../stores/authStore'
import { useBrandStore } from '../stores/brandStore'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { NavigationMenu, NavigationMenuItem, NavigationMenuList, navigationMenuTriggerStyle } from '@/components/ui/navigation-menu'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuthStore()
  const { selectedBrand, brands, setSelectedBrand } = useBrandStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="bg-card shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link to="/" className="flex-shrink-0">
                <h1 className="text-xl font-bold text-foreground">
                  Instagram AI Agency
                </h1>
              </Link>
              <NavigationMenu className="ml-6">
                <NavigationMenuList>
                  <NavigationMenuItem>
                    <Link to="/dashboard" className={navigationMenuTriggerStyle()}>
                      Dashboard
                    </Link>
                  </NavigationMenuItem>
                  <NavigationMenuItem>
                    <Link to="/brands" className={navigationMenuTriggerStyle()}>
                      Brands
                    </Link>
                  </NavigationMenuItem>
                  <NavigationMenuItem>
                    <Link to="/content" className={navigationMenuTriggerStyle()}>
                      Content
                    </Link>
                  </NavigationMenuItem>
                  <NavigationMenuItem>
                    <Link to="/analytics" className={navigationMenuTriggerStyle()}>
                      Analytics
                    </Link>
                  </NavigationMenuItem>
                  <NavigationMenuItem>
                    <Link to="/engagement" className={navigationMenuTriggerStyle()}>
                      Engagement
                    </Link>
                  </NavigationMenuItem>
                  <NavigationMenuItem>
                    <Link to="/growth" className={navigationMenuTriggerStyle()}>
                      Growth
                    </Link>
                  </NavigationMenuItem>
                  <NavigationMenuItem>
                    <Link to="/ai-features" className={navigationMenuTriggerStyle()}>
                      AI Features
                    </Link>
                  </NavigationMenuItem>
                </NavigationMenuList>
              </NavigationMenu>
            </div>
            
            <div className="flex items-center space-x-4">
              {/* Brand Selector */}
              {brands.length > 0 && (
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-muted-foreground">Brand:</span>
                  <Select
                    value={selectedBrand?.id || ''}
                    onValueChange={(value) => {
                      const brand = brands.find(b => b.id === value)
                      setSelectedBrand(brand || null)
                    }}
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="Select Brand" />
                    </SelectTrigger>
                    <SelectContent>
                      {brands.map((brand) => (
                        <SelectItem key={brand.id} value={brand.id}>
                          {brand.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              
              {user && (
                <>
                  <span className="text-sm text-foreground">
                    Welcome, {user.name || user.email}
                  </span>
                  <Button
                    onClick={handleLogout}
                    variant="default"
                    size="sm"
                  >
                    Logout
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  )
}